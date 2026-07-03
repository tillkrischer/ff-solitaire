type Suit = "cups" | "swords" | "stars" | "thorns";

type State = {
  tableau: string[][];
  park: string | null;
  minor: number[];
  majorLow: number;
  majorHigh: number;
};

type LocationType = "column" | "park";
type Move = {
  fromType: LocationType;
  fromIndex: number;
  toType: LocationType;
  toIndex: number;
};

type SearchNode = {
  state: State;
  path: string[];
  priority: number;
};

const SUIT_CODES: Record<Suit, string> = {
  cups: "C",
  swords: "S",
  stars: "A",
  thorns: "T",
};

export type SolveOptions = {
  beam?: number;
  trimEvery?: number;
  maxVisited?: number;
};

export type SolveBoardResult = {
  path: string[] | null;
  visited: number;
  ms: number;
};

class MaxHeap<T> {
  private values: T[] = [];
  private readonly score: (value: T) => number;

  constructor(score: (value: T) => number) {
    this.score = score;
  }

  get length(): number {
    return this.values.length;
  }

  push(value: T): void {
    this.values.push(value);
    this.bubbleUp(this.values.length - 1);
  }

  pop(): T | undefined {
    if (this.values.length === 0) return undefined;
    const best = this.values[0];
    const last = this.values.pop();
    if (last && this.values.length > 0) {
      this.values[0] = last;
      this.sinkDown(0);
    }
    return best;
  }

  keepBest(limit: number): void {
    if (this.values.length <= limit) return;
    this.values.sort((a, b) => this.score(b) - this.score(a));
    this.values.length = limit;
    for (let i = Math.floor(this.values.length / 2); i >= 0; i--) {
      this.sinkDown(i);
    }
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.score(this.values[parent]) >= this.score(this.values[index])) return;
      [this.values[parent], this.values[index]] = [this.values[index], this.values[parent]];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.values.length && this.score(this.values[left]) > this.score(this.values[best])) {
        best = left;
      }
      if (right < this.values.length && this.score(this.values[right]) > this.score(this.values[best])) {
        best = right;
      }
      if (best === index) return;
      [this.values[index], this.values[best]] = [this.values[best], this.values[index]];
      index = best;
    }
  }
}

function decodeCard(card: string): { kind: "major"; rank: number } | { kind: "minor"; suitIndex: number; rank: number } {
  if (card[0] === "M") return { kind: "major", rank: Number(card.slice(1)) };
  const suitIndex = Object.values(SUIT_CODES).indexOf(card[0]);
  if (suitIndex === -1) throw new Error(`Unknown card suit code: ${card}`);
  return { kind: "minor", suitIndex, rank: Number(card.slice(1)) };
}

function parseBoard(input: string): State {
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

  return autoMoveFoundations(state);
}

function cloneState(state: State): State {
  return {
    tableau: state.tableau.map((column) => column.slice()),
    park: state.park,
    minor: state.minor.slice(),
    majorLow: state.majorLow,
    majorHigh: state.majorHigh,
  };
}

function canMoveToFoundation(state: State, card: string, fromPark: boolean): boolean {
  const decoded = decodeCard(card);
  if (decoded.kind === "major") {
    return decoded.rank === state.majorLow + 1 || decoded.rank === state.majorHigh - 1;
  }
  if (!fromPark && state.park !== null) return false;
  return decoded.rank === state.minor[decoded.suitIndex] + 1;
}

function moveCardToFoundation(state: State, card: string): void {
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

function autoMoveFoundations(input: State): State {
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

function canStackOn(card: string, target: string): boolean {
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

function getSourceCard(state: State, type: LocationType, index: number): string | null {
  if (type === "park") return state.park;
  const column = state.tableau[index];
  return column[column.length - 1] ?? null;
}

function getValidMoves(state: State): Move[] {
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

  return orderMoves(state, moves);
}

function applyMove(state: State, move: Move): State {
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
  return autoMoveFoundations(next);
}

function orderMoves(state: State, moves: Move[]): Move[] {
  return moves.sort((a, b) => moveScore(state, b) - moveScore(state, a));
}

function moveScore(state: State, move: Move): number {
  const card = getSourceCard(state, move.fromType, move.fromIndex);
  if (!card) return -1000;
  let score = 0;
  const fromColumn = move.fromType === "column" ? state.tableau[move.fromIndex] : null;
  const toColumn = move.toType === "column" ? state.tableau[move.toIndex] : null;
  if (move.toType === "column" && toColumn?.length === 0) score += 15;
  if (move.fromType === "park") score += 20;
  if (move.toType === "park") score -= 8;
  if (fromColumn?.length === 1) score += 18;
  if (move.toType === "column" && toColumn && toColumn.length > 0) score += 8;
  if (canMoveToFoundation(applyManualOnly(state, move), card, move.toType === "park")) score += 30;
  return score;
}

function applyManualOnly(state: State, move: Move): State {
  const next = cloneState(state);
  const card = move.fromType === "park" ? next.park : next.tableau[move.fromIndex].pop() ?? null;
  if (!card) return next;
  if (move.fromType === "park") next.park = null;
  if (move.toType === "park") next.park = card;
  else next.tableau[move.toIndex].push(card);
  return next;
}

function hashState(state: State): string {
  return [
    state.majorLow,
    state.majorHigh,
    state.minor.join(","),
    state.park ?? ".",
    ...state.tableau.map((column) => column.join(".")),
  ].join("|");
}

function isGoalState(state: State): boolean {
  return (
    state.park === null &&
    state.tableau.every((column) => column.length === 0) &&
    state.minor.every((rank) => rank === 13) &&
    state.majorLow + (21 - state.majorHigh) + 2 === 22
  );
}

function progress(state: State): number {
  return state.minor.reduce((sum, rank) => sum + rank, 0) + state.majorLow + 1 + (22 - state.majorHigh);
}

function stateScore(state: State, depth: number): number {
  let score = progress(state) * 1000;
  score += state.tableau.filter((column) => column.length === 0).length * 90;
  score += state.park === null ? 35 : -40;
  score -= depth * 3;

  for (const column of state.tableau) {
    score -= column.length;
    for (let i = 0; i < column.length - 1; i++) {
      const below = column[i];
      const above = column[i + 1];
      if (canStackOn(above, below)) score += 8;
    }
    const top = column[column.length - 1];
    if (top && canMoveToFoundation(state, top, false)) score += 60;
  }
  if (state.park && canMoveToFoundation(state, state.park, true)) score += 80;
  return score;
}

function solve(initialState: State, options: Required<SolveOptions>): {
  path: string[] | null;
  visited: number;
} {
  const queue = new MaxHeap<SearchNode>((node) => node.priority);
  const visited = new Set<string>();
  queue.push({ state: initialState, path: [], priority: stateScore(initialState, 0) });

  let explored = 0;
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) break;
    const hash = hashState(current.state);
    if (visited.has(hash)) continue;
    visited.add(hash);
    explored++;

    if (isGoalState(current.state)) {
      return { path: current.path, visited: explored };
    }
    if (visited.size >= options.maxVisited) break;

    for (const move of getValidMoves(current.state)) {
      const nextState = applyMove(current.state, move);
      const nextHash = hashState(nextState);
      if (visited.has(nextHash)) continue;
      const path = [...current.path, formatMove(move)];
      queue.push({ state: nextState, path, priority: stateScore(nextState, path.length) });
    }

    if (explored % options.trimEvery === 0) {
      queue.keepBest(options.beam);
    }
  }

  return { path: null, visited: explored };
}

function formatMove(move: Move): string {
  return `${move.fromType},${move.fromIndex}:${move.toType},${move.toIndex}`;
}

function replay(initialState: State, path: string[]): State {
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

export function solveBoard(board: string, options: SolveOptions = {}): SolveBoardResult {
  const solveOptions = {
    beam: options.beam ?? 1000,
    trimEvery: options.trimEvery ?? 10000,
    maxVisited: options.maxVisited ?? 5_000_000,
  };
  const initial = parseBoard(board);
  const started = Date.now();
  const result = solve(initial, solveOptions);
  const ms = Date.now() - started;
  if (result.path) {
    const final = replay(initial, result.path);
    if (!isGoalState(final)) throw new Error("Solved path replay did not reach a goal");
  }
  return { path: result.path, visited: result.visited, ms };
}
