import type {
  Card,
  CardId,
  GameState,
  GameStateSnapshot,
  Location,
  MoveCommand,
  Suit,
  TableauLocation
} from "./types";
import { suits } from "./types";

type FoundationTarget = { type: "minor-foundation"; suit: Suit } | { type: "major-low" } | { type: "major-high" };

export function canStackOnTableau(bottomCard: Card, movingCard: Card): boolean {
  if (bottomCard.kind === "minor" && movingCard.kind === "minor") {
    return bottomCard.suit === movingCard.suit && Math.abs(bottomCard.rank - movingCard.rank) === 1;
  }

  if (bottomCard.kind === "major" && movingCard.kind === "major") {
    return Math.abs(bottomCard.rank - movingCard.rank) === 1;
  }

  return false;
}

export function getMovableCards(state: GameState, from: Location): CardId[] {
  if (from.type === "park") {
    return state.parkedCard === null ? [] : [state.parkedCard];
  }

  if (from.type !== "tableau") {
    return [];
  }

  const column = state.tableau[from.column];
  if (!column || column.length === 0) {
    return [];
  }

  const topIndex = column.length - 1;
  const requestedIndex = from.index ?? topIndex;
  if (requestedIndex !== topIndex) {
    return [];
  }

  if (state.moveMode === "single-card") {
    return [column[topIndex]];
  }

  const moving = [column[topIndex]];
  for (let index = topIndex - 1; index >= 0; index -= 1) {
    const lowerCard = state.cardsById[column[index]];
    const upperCard = state.cardsById[column[index + 1]];
    if (!canStackOnTableau(upperCard, lowerCard)) {
      break;
    }
    moving.push(column[index]);
  }

  return moving;
}

export function canMove(state: GameState, command: MoveCommand): boolean {
  const movingCards = getMovableCards(state, command.from);
  if (movingCards.length === 0) {
    return false;
  }

  if (isSameLocation(command.from, command.to)) {
    return false;
  }

  const firstMovingCard = state.cardsById[movingCards[0]];

  switch (command.to.type) {
    case "tableau": {
      const destinationColumn = state.tableau[command.to.column];
      if (!destinationColumn) {
        return false;
      }

      if (command.from.type === "tableau" && command.from.column === command.to.column) {
        return false;
      }

      if (destinationColumn.length === 0) {
        return true;
      }

      const destinationTopCard = state.cardsById[destinationColumn[destinationColumn.length - 1]];
      return canStackOnTableau(destinationTopCard, firstMovingCard);
    }

    case "park":
      return command.from.type === "tableau" && movingCards.length === 1 && state.parkedCard === null;

    case "minor-foundation":
    case "major-low":
    case "major-high":
      return movingCards.length === 1 && canMoveCardToFoundation(state, movingCards[0], command.to);
  }
}

export function applyMove(state: GameState, command: MoveCommand): GameState {
  if (!canMove(state, command)) {
    return state;
  }

  const snapshot = snapshotState(state);
  const moved = applyManualMove(state, command);
  const swept = autoMoveFoundations(moved);
  const nextState = {
    ...swept,
    history: [...state.history, snapshot]
  };

  return {
    ...nextState,
    status: isWon(nextState) ? "won" : "playing"
  };
}

export function undo(state: GameState): GameState {
  const previous = state.history[state.history.length - 1];
  if (!previous) {
    return state;
  }

  return {
    ...previous,
    history: state.history.slice(0, -1)
  };
}

export function autoMoveFoundations(state: GameState): GameState {
  let current = state;
  let moved = true;

  while (moved) {
    moved = false;

    for (let columnIndex = 0; columnIndex < current.tableau.length; columnIndex += 1) {
      const column = current.tableau[columnIndex];
      const topCardId = column[column.length - 1];
      const target = topCardId ? getAutoFoundationTarget(current, topCardId) : null;

      if (target) {
        current = applyManualMove(current, {
          from: { type: "tableau", column: columnIndex },
          to: target
        });
        moved = true;
        break;
      }
    }

    if (moved) {
      continue;
    }

    if (current.parkedCard) {
      const target = getAutoFoundationTarget(current, current.parkedCard);
      if (target) {
        current = applyManualMove(current, {
          from: { type: "park" },
          to: target
        });
        moved = true;
      }
    }
  }

  return current;
}

export function canMoveCardToFoundation(state: GameState, cardId: CardId, target: FoundationTarget): boolean {
  const card = state.cardsById[cardId];

  if (target.type === "minor-foundation") {
    if (card.kind !== "minor" || card.suit !== target.suit || state.parkedCard !== null) {
      return false;
    }

    const foundation = state.foundations.minor[target.suit];
    const topCard = state.cardsById[foundation[foundation.length - 1]];
    return topCard.kind === "minor" && card.rank === topCard.rank + 1;
  }

  if (card.kind !== "major") {
    return false;
  }

  if (target.type === "major-low") {
    const topCardId = state.foundations.majorLow[state.foundations.majorLow.length - 1];
    return topCardId ? card.rank === state.cardsById[topCardId].rank + 1 : card.rank === 0;
  }

  const topCardId = state.foundations.majorHigh[state.foundations.majorHigh.length - 1];
  return topCardId ? card.rank === state.cardsById[topCardId].rank - 1 : card.rank === 21;
}

export function getAutoFoundationTarget(state: GameState, cardId: CardId): FoundationTarget | null {
  const card = state.cardsById[cardId];

  if (card.kind === "minor") {
    const target = { type: "minor-foundation" as const, suit: card.suit };
    return canMoveCardToFoundation(state, cardId, target) ? target : null;
  }

  if (canMoveCardToFoundation(state, cardId, { type: "major-low" })) {
    return { type: "major-low" };
  }

  if (canMoveCardToFoundation(state, cardId, { type: "major-high" })) {
    return { type: "major-high" };
  }

  return null;
}

export function isWon(state: GameState): boolean {
  const tableauEmpty = state.tableau.every((column) => column.length === 0);
  const minorComplete = suits.every((suit) => state.foundations.minor[suit].length === 13);
  const majorComplete = state.foundations.majorLow.length + state.foundations.majorHigh.length === 22;
  return tableauEmpty && state.parkedCard === null && minorComplete && majorComplete;
}

export function hashState(state: GameState): string {
  return JSON.stringify({
    tableau: state.tableau,
    foundations: state.foundations,
    parkedCard: state.parkedCard,
    moveMode: state.moveMode,
    status: state.status
  });
}

export function snapshotState(state: GameState): GameStateSnapshot {
  return {
    cardsById: state.cardsById,
    tableau: state.tableau.map((column) => [...column]),
    foundations: {
      minor: {
        cups: [...state.foundations.minor.cups],
        swords: [...state.foundations.minor.swords],
        stars: [...state.foundations.minor.stars],
        thorns: [...state.foundations.minor.thorns]
      },
      majorLow: [...state.foundations.majorLow],
      majorHigh: [...state.foundations.majorHigh]
    },
    parkedCard: state.parkedCard,
    moveMode: state.moveMode,
    seed: state.seed,
    status: state.status
  };
}

function applyManualMove(state: GameState, command: MoveCommand): GameState {
  const movingCards = getMovableCards(state, command.from);
  let nextState = removeMovingCards(state, command.from, movingCards);
  nextState = placeMovingCards(nextState, command.to, movingCards);

  return {
    ...nextState,
    status: isWon(nextState) ? "won" : "playing"
  };
}

function removeMovingCards(state: GameState, from: Location, movingCards: CardId[]): GameState {
  if (from.type === "park") {
    return {
      ...state,
      parkedCard: null
    };
  }

  if (from.type !== "tableau") {
    return state;
  }

  const tableau = state.tableau.map((column, index) =>
    index === from.column ? column.slice(0, column.length - movingCards.length) : column
  );

  return {
    ...state,
    tableau
  };
}

function placeMovingCards(state: GameState, to: Location, movingCards: CardId[]): GameState {
  switch (to.type) {
    case "tableau":
      return {
        ...state,
        tableau: state.tableau.map((column, index) => (index === to.column ? [...column, ...movingCards] : column))
      };

    case "park":
      return {
        ...state,
        parkedCard: movingCards[0]
      };

    case "minor-foundation":
      return {
        ...state,
        foundations: {
          ...state.foundations,
          minor: {
            ...state.foundations.minor,
            [to.suit]: [...state.foundations.minor[to.suit], movingCards[0]]
          }
        }
      };

    case "major-low":
      return {
        ...state,
        foundations: {
          ...state.foundations,
          majorLow: [...state.foundations.majorLow, movingCards[0]]
        }
      };

    case "major-high":
      return {
        ...state,
        foundations: {
          ...state.foundations,
          majorHigh: [...state.foundations.majorHigh, movingCards[0]]
        }
      };
  }
}

function isSameLocation(from: Location, to: Location): boolean {
  if (from.type !== to.type) {
    return false;
  }

  if (from.type === "tableau" && to.type === "tableau") {
    return from.column === to.column;
  }

  if (from.type === "minor-foundation" && to.type === "minor-foundation") {
    return from.suit === to.suit;
  }

  return true;
}

export function tableauTopLocation(column: number): TableauLocation {
  return { type: "tableau", column };
}
