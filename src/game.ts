export type Suit = "cups" | "swords" | "stars" | "thorns";

export type State = {
  tableau: string[][];
  park: string | null;
  minor: number[];
  majorLow: number;
  majorHigh: number;
};

export type LocationType = "column" | "park";

export type Move = {
  fromType: LocationType;
  fromIndex: number;
  toType: LocationType;
  toIndex: number;
};

export type DecodedCard = { kind: "major"; rank: number } | { kind: "minor"; suitIndex: number; rank: number };

export const SUIT_CODES: Record<Suit, string> = {
  cups: "C",
  swords: "S",
  stars: "A",
  thorns: "T",
};

export const INITIAL_STATE: State = {
  majorLow: -1,
  majorHigh: 22,
  minor: [1, 1, 1, 1],
  park: null,
  tableau: [[], [], [], [], [], [], [], [], [], [], []],
};

export function decodeCard(card: string): DecodedCard {
  if (card[0] === "M") return { kind: "major", rank: Number(card.slice(1)) };
  const suitIndex = Object.values(SUIT_CODES).indexOf(card[0]);
  if (suitIndex === -1) throw new Error(`Unknown card suit code: ${card}`);
  return { kind: "minor", suitIndex, rank: Number(card.slice(1)) };
}

export function parseBoard(input: string, options: { autoMove?: boolean } = {}): State {
  const text = input.trim();
  const [majorLowText, majorHighText, minorText, parkText, ...columnTexts] = text.split("|");
  if (!majorLowText || !majorHighText || !minorText || parkText === undefined || columnTexts.length === 0) {
    throw new Error("Board must use the compact deal text format");
  }

  const minor = minorText.split(",").map((rank) => Number(rank));
  if (minor.length !== 4 || minor.some((rank) => !Number.isInteger(rank))) {
    throw new Error(`Invalid minor foundation ranks: ${minorText}`);
  }

  const state: State = {
    majorLow: Number(majorLowText),
    majorHigh: Number(majorHighText),
    minor,
    park: parkText === "." ? null : parkText,
    tableau: columnTexts.map((column) => (column === "" ? [] : column.split("."))),
  };

  if (!Number.isInteger(state.majorLow) || !Number.isInteger(state.majorHigh)) {
    throw new Error(`Invalid major foundation ranks: ${majorLowText}|${majorHighText}`);
  }

  return options.autoMove === false ? state : autoMoveFoundations(state);
}

export function serializeBoard(state: State): string {
  return [
    state.majorLow,
    state.majorHigh,
    state.minor.join(","),
    state.park ?? ".",
    ...state.tableau.map((column) => column.join(".")),
  ].join("|");
}

export function cloneState(state: State): State {
  return {
    tableau: state.tableau.map((column) => column.slice()),
    park: state.park,
    minor: state.minor.slice(),
    majorLow: state.majorLow,
    majorHigh: state.majorHigh,
  };
}

export function canMoveToFoundation(state: State, card: string, fromPark: boolean): boolean {
  const decoded = decodeCard(card);
  if (decoded.kind === "major") {
    return decoded.rank === state.majorLow + 1 || decoded.rank === state.majorHigh - 1;
  }
  if (!fromPark && state.park !== null) return false;
  return decoded.rank === state.minor[decoded.suitIndex] + 1;
}

export function moveCardToFoundation(state: State, card: string): void {
  const decoded = decodeCard(card);
  if (decoded.kind === "major") {
    if (decoded.rank === state.majorLow + 1) {
      state.majorLow = decoded.rank;
    } else if (decoded.rank === state.majorHigh - 1) {
      state.majorHigh = decoded.rank;
    } else {
      throw new Error(`Illegal major foundation move: ${card}`);
    }
    return;
  }
  if (decoded.rank !== state.minor[decoded.suitIndex] + 1) {
    throw new Error(`Illegal minor foundation move: ${card}`);
  }
  state.minor[decoded.suitIndex] = decoded.rank;
}

export function autoMoveFoundations(input: State): State {
  const state = cloneState(input);
  let changed = true;
  while (changed) {
    changed = false;
    if (state.park && canMoveToFoundation(state, state.park, true)) {
      moveCardToFoundation(state, state.park);
      state.park = null;
      changed = true;
      continue;
    }
    for (const column of state.tableau) {
      const card = column[column.length - 1];
      if (card && canMoveToFoundation(state, card, false)) {
        column.pop();
        moveCardToFoundation(state, card);
        changed = true;
        break;
      }
    }
  }
  return state;
}

export function canStackOn(card: string, target: string): boolean {
  const source = decodeCard(card);
  const destination = decodeCard(target);
  if (source.kind !== destination.kind) return false;
  if (source.kind === "major" && destination.kind === "major") {
    return Math.abs(source.rank - destination.rank) === 1;
  }
  if (source.kind === "minor" && destination.kind === "minor") {
    return source.suitIndex === destination.suitIndex && Math.abs(source.rank - destination.rank) === 1;
  }
  return false;
}

export function getSourceCard(state: State, type: LocationType, index: number): string | null {
  if (type === "park") return state.park;
  const column = state.tableau[index];
  return column[column.length - 1] ?? null;
}

export function getValidMoves(state: State): Move[] {
  const moves: Move[] = [];
  const sources: Move[] = [];
  if (state.park) {
    sources.push({ fromType: "park", fromIndex: 0, toType: "column", toIndex: -1 });
  }
  for (let i = 0; i < state.tableau.length; i++) {
    if (state.tableau[i].length > 0) {
      sources.push({ fromType: "column", fromIndex: i, toType: "column", toIndex: -1 });
    }
  }

  for (const source of sources) {
    const card = getSourceCard(state, source.fromType, source.fromIndex);
    if (!card) continue;

    if (source.fromType === "column" && state.park === null) {
      moves.push({ ...source, toType: "park", toIndex: 0 });
    }

    for (let toIndex = 0; toIndex < state.tableau.length; toIndex++) {
      if (source.fromType === "column" && source.fromIndex === toIndex) continue;
      const targetColumn = state.tableau[toIndex];
      const targetCard = targetColumn[targetColumn.length - 1];
      if (!targetCard || canStackOn(card, targetCard)) {
        moves.push({ ...source, toType: "column", toIndex });
      }
    }
  }

  return moves;
}

export function applyMove(state: State, move: Move): State {
  const next = applyManualOnly(state, move);
  return autoMoveFoundations(next);
}

export function applyManualOnly(state: State, move: Move): State {
  const next = cloneState(state);
  const card = move.fromType === "park" ? next.park : next.tableau[move.fromIndex].pop() ?? null;
  if (!card) throw new Error(`Move has no source card: ${formatMove(move)}`);
  if (move.fromType === "park") next.park = null;

  if (move.toType === "park") {
    if (next.park !== null) throw new Error("Cannot move to occupied park");
    next.park = card;
  } else {
    next.tableau[move.toIndex].push(card);
  }

  return next;
}

export function hashState(state: State): string {
  return serializeBoard(state);
}

export function isGoalState(state: State): boolean {
  return (
    state.park === null &&
    state.tableau.every((column) => column.length === 0) &&
    state.minor.every((rank) => rank === 13) &&
    state.majorLow + (21 - state.majorHigh) + 2 === 22
  );
}

export function formatMove(move: Move): string {
  return `${move.fromType},${move.fromIndex}:${move.toType},${move.toIndex}`;
}

export function replay(initialState: State, path: string[]): State {
  let state = initialState;
  for (const text of path) {
    const [from, to] = text.split(":");
    const [fromType, fromIndex] = from.split(",");
    const [toType, toIndex] = to.split(",");
    state = applyMove(state, {
      fromType: fromType as LocationType,
      fromIndex: Number(fromIndex),
      toType: toType as LocationType,
      toIndex: Number(toIndex),
    });
  }
  return state;
}
