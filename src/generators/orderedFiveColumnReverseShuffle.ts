import {
  INITIAL_STATE,
  applyManualOnly,
  applyMove,
  cloneState,
  formatMove,
  getSourceCard,
  getValidMoves,
  isGoalState,
  serializeBoard,
  type Move,
  type State,
} from "../game.ts";
import { validateInitialDeal } from "../dealValidation.ts";
import type { GenerateDealOptions, GenerateDealResult, GenerationStrategy } from "../generator.ts";
import { assertValidMaxAttempts, createRandom, type Random } from "./shared.ts";

const STRATEGY_NAME = "ordered-five-column-reverse-shuffle";
const DEFAULT_MAX_ATTEMPTS = 1_000;
const TARGET_COLUMN_SIZES = [7, 7, 7, 7, 7, 0, 7, 7, 7, 7, 7];
const BUFFER_COLUMNS = [6, 7, 8, 9, 10];
const SUIT_SOURCES = ["C", "S", "A", "T"] as const;

type SourceCode = (typeof SUIT_SOURCES)[number] | "M";
type Chain = {
  source: SourceCode;
  cards: string[];
};

export const orderedFiveColumnReverseShuffleStrategy: GenerationStrategy = {
  name: STRATEGY_NAME,
  generate: generateOrderedFiveColumnReverseShuffle,
};

export function generateOrderedFiveColumnReverseShuffle(options: GenerateDealOptions = {}): GenerateDealResult {
  const seed = String(options.seed ?? "default");
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  assertValidMaxAttempts(maxAttempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const random = createRandom(`${seed}:${attempt}`);
    const built = buildAttempt(random);
    if (!built) continue;

    const validation = validateInitialDeal(serializeBoard(built.state));
    if (!validation.ok) continue;
    if (!isGoalState(replayMoves(built.state, built.proofPath))) continue;

    return {
      board: serializeBoard(built.state),
      seed,
      attempts: attempt,
      strategy: options.strategy ?? STRATEGY_NAME,
      metadata: {
        proof: STRATEGY_NAME,
        sourceShape: {
          minorColumns: "13..2",
          majorColumn: "21..0",
        },
        reverseShuffleMoveCount: built.reverseMoves.length,
        targetColumnSizes: TARGET_COLUMN_SIZES,
        bufferColumns: built.bufferColumns,
        proofPath: built.proofPath.map(formatMove),
        reverseShufflePath: built.reverseMoves.map(formatMove),
      },
    };
  }

  throw new Error(`Unable to generate an ordered five-column reverse shuffle after ${maxAttempts.toLocaleString()} attempts`);
}

function buildAttempt(random: Random): {
  state: State;
  proofPath: Move[];
  reverseMoves: Move[];
  bufferColumns: number[];
} | null {
  const exposureOrder = buildExposureOrder(random);
  if (!exposureOrder) return null;

  const bufferColumns = shuffle(random, BUFFER_COLUMNS);
  let state = buildOrderedFoundationReadyState();
  const reverseMoves: Move[] = [];

  for (let index = exposureOrder.length - 1; index >= 0; index--) {
    const card = exposureOrder[index];
    const move: Move = {
      fromType: "column",
      fromIndex: sourceColumnForCard(card),
      toType: "column",
      toIndex: bufferColumns[Math.floor(index / 7)],
    };
    if (getSourceCard(state, move.fromType, move.fromIndex) !== card) return null;

    const next = applyManualOnly(state, move);
    const inverse = invertMove(move);
    if (!includesMove(getValidMoves(next), inverse)) return null;

    state = next;
    reverseMoves.push(move);
  }

  if (!hasTargetShape(state)) return null;
  const proofPath = buildProofPath(state, exposureOrder, bufferColumns);
  if (!proofPath) return null;

  return { state, proofPath, reverseMoves, bufferColumns };
}

function buildOrderedFoundationReadyState(): State {
  const tableau = INITIAL_STATE.tableau.map(() => [] as string[]);

  for (let suitIndex = 0; suitIndex < SUIT_SOURCES.length; suitIndex++) {
    const suit = SUIT_SOURCES[suitIndex];
    for (let rank = 13; rank >= 2; rank--) {
      tableau[suitIndex].push(`${suit}${rank}`);
    }
  }

  for (let rank = 21; rank >= 0; rank--) {
    tableau[4].push(`M${rank}`);
  }

  return {
    ...cloneState(INITIAL_STATE),
    tableau,
  };
}

function buildExposureOrder(random: Random): string[] | null {
  const chains: Chain[] = [
    { source: "M", cards: rangeDescending(14, 0).map((rank) => `M${rank}`) },
    ...SUIT_SOURCES.map((source) => ({
      source,
      cards: rangeDescending(6, 2).map((rank) => `${source}${rank}`),
    })),
  ];

  return chooseExposureOrder(random, chains, []);
}

function chooseExposureOrder(random: Random, chains: Chain[], order: string[]): string[] | null {
  if (order.length === 35) return order;

  for (const chain of shuffle(random, chains)) {
    if (chain.cards.length === 0) continue;
    const card = chain.cards[0];
    if (order.length % 7 === 0 && initiallyAutoMoves(card)) continue;

    const nextChains = chains.map((candidate) =>
      candidate.source === chain.source ? { ...candidate, cards: candidate.cards.slice(1) } : candidate,
    );
    const result = chooseExposureOrder(random, nextChains, [...order, card]);
    if (result) return result;
  }

  return null;
}

function buildProofPath(initial: State, exposureOrder: string[], bufferColumns: number[]): Move[] | null {
  let state = cloneState(initial);
  const proofPath: Move[] = [];

  for (let index = 0; index < exposureOrder.length; index++) {
    const card = exposureOrder[index];
    const sourceColumn = bufferColumns[Math.floor(index / 7)];
    if (getSourceCard(state, "column", sourceColumn) !== card) {
      if (cardIsGone(state, card)) continue;
      return null;
    }

    const move: Move = {
      fromType: "column",
      fromIndex: sourceColumn,
      toType: "column",
      toIndex: sourceColumnForCard(card),
    };
    if (!includesMove(getValidMoves(state), move)) return null;

    state = applyMove(state, move);
    proofPath.push(move);
  }

  return isGoalState(state) ? proofPath : null;
}

function replayMoves(initial: State, moves: Move[]): State {
  let state = cloneState(initial);
  for (const move of moves) {
    state = applyMove(state, move);
  }
  return state;
}

function hasTargetShape(state: State): boolean {
  return (
    state.park === null &&
    state.tableau.length === TARGET_COLUMN_SIZES.length &&
    state.tableau.every((column, index) => column.length === TARGET_COLUMN_SIZES[index])
  );
}

function sourceColumnForCard(card: string): number {
  if (card[0] === "M") return 4;
  const index = SUIT_SOURCES.indexOf(card[0] as (typeof SUIT_SOURCES)[number]);
  if (index === -1) throw new Error(`Unknown source card: ${card}`);
  return index;
}

function cardIsGone(state: State, card: string): boolean {
  return state.park !== card && !state.tableau.some((column) => column.includes(card));
}

function invertMove(move: Move): Move {
  return {
    fromType: move.toType,
    fromIndex: move.toIndex,
    toType: move.fromType,
    toIndex: move.fromIndex,
  };
}

function includesMove(moves: Move[], target: Move): boolean {
  return moves.some(
    (move) =>
      move.fromType === target.fromType &&
      move.fromIndex === target.fromIndex &&
      move.toType === target.toType &&
      move.toIndex === target.toIndex,
  );
}

function initiallyAutoMoves(card: string): boolean {
  return card === "M0" || card === "M21" || (card[0] !== "M" && card.slice(1) === "2");
}

function rangeDescending(high: number, low: number): number[] {
  const values: number[] = [];
  for (let rank = high; rank >= low; rank--) values.push(rank);
  return values;
}

function shuffle<T>(random: Random, values: readonly T[]): T[] {
  const shuffled = values.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
