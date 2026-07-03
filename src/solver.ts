import {
  applyManualOnly,
  applyMove,
  canMoveToFoundation,
  canStackOn,
  decodeCard,
  formatMove,
  getSourceCard,
  getValidMoves,
  hashState,
  isGoalState,
  parseBoard,
  replay,
  SUIT_CODES,
  type Move,
  type State,
} from "./game.ts";

type SearchNode = {
  state: State;
  path: string[];
  priority: number;
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
  metrics: SolveMetrics;
};

export type SolveMetrics = {
  peakFrontier: number;
  generatedMoves: number;
  avgBranching: number;
  maxBranching: number;
  duplicateSkips: number;
  trimCount: number;
  trimmedNodes: number;
  longestFoundationDrought: number;
  zeroProgressMoves: number;
  cascadeCount: number;
  maxCascadeSize: number;
  avgCascadeSize: number;
  movesToPark: number;
  movesFromPark: number;
  maxConsecutiveParkOccupiedMoves: number;
  parkBlockedMinorOpportunities: number;
  avgEmptyColumns: number;
  minEmptyColumns: number;
  maxEmptyColumns: number;
  firstEmptyColumnMove: number | null;
  initialBlockerScore: number;
};

type SearchMetrics = {
  peakFrontier: number;
  generatedMoves: number;
  maxBranching: number;
  duplicateSkips: number;
  trimCount: number;
  trimmedNodes: number;
};

type ReplayMetrics = Omit<
  SolveMetrics,
  | "peakFrontier"
  | "generatedMoves"
  | "avgBranching"
  | "maxBranching"
  | "duplicateSkips"
  | "trimCount"
  | "trimmedNodes"
  | "initialBlockerScore"
>;

type ParsedMove = Move & {
  card: string;
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

  keepBest(limit: number): number {
    if (this.values.length <= limit) return 0;
    const trimmed = this.values.length - limit;
    this.values.sort((a, b) => this.score(b) - this.score(a));
    this.values.length = limit;
    for (let i = Math.floor(this.values.length / 2); i >= 0; i--) {
      this.sinkDown(i);
    }
    return trimmed;
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
  searchMetrics: SearchMetrics;
} {
  const queue = new MaxHeap<SearchNode>((node) => node.priority);
  const visited = new Set<string>();
  queue.push({ state: initialState, path: [], priority: stateScore(initialState, 0) });
  const searchMetrics: SearchMetrics = {
    peakFrontier: queue.length,
    generatedMoves: 0,
    maxBranching: 0,
    duplicateSkips: 0,
    trimCount: 0,
    trimmedNodes: 0,
  };

  let explored = 0;
  while (queue.length > 0) {
    searchMetrics.peakFrontier = Math.max(searchMetrics.peakFrontier, queue.length);
    const current = queue.pop();
    if (!current) break;
    const hash = hashState(current.state);
    if (visited.has(hash)) continue;
    visited.add(hash);
    explored++;

    if (isGoalState(current.state)) {
      return { path: current.path, visited: explored, searchMetrics };
    }
    if (visited.size >= options.maxVisited) break;

    const moves = getValidMoves(current.state);
    searchMetrics.generatedMoves += moves.length;
    searchMetrics.maxBranching = Math.max(searchMetrics.maxBranching, moves.length);

    for (const move of orderMoves(current.state, moves)) {
      const nextState = applyMove(current.state, move);
      const nextHash = hashState(nextState);
      if (visited.has(nextHash)) {
        searchMetrics.duplicateSkips++;
        continue;
      }
      const path = [...current.path, formatMove(move)];
      queue.push({ state: nextState, path, priority: stateScore(nextState, path.length) });
    }

    if (explored % options.trimEvery === 0) {
      const trimmed = queue.keepBest(options.beam);
      if (trimmed > 0) {
        searchMetrics.trimCount++;
        searchMetrics.trimmedNodes += trimmed;
      }
    }
  }

  return { path: null, visited: explored, searchMetrics };
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
  const replayMetrics = result.path ? analyzeSolutionReplay(initial, result.path) : emptyReplayMetrics(initial);
  const metrics = combineMetrics(result.searchMetrics, result.visited, replayMetrics, initial);
  if (result.path) {
    const final = replay(initial, result.path);
    if (!isGoalState(final)) throw new Error("Solved path replay did not reach a goal");
  }
  return { path: result.path, visited: result.visited, ms, metrics };
}

function combineMetrics(
  searchMetrics: SearchMetrics,
  visited: number,
  replayMetrics: ReplayMetrics,
  initialState: State,
): SolveMetrics {
  return {
    ...searchMetrics,
    avgBranching: visited === 0 ? 0 : searchMetrics.generatedMoves / visited,
    ...replayMetrics,
    initialBlockerScore: initialBlockerScore(initialState),
  };
}

function emptyReplayMetrics(initialState: State): ReplayMetrics {
  const emptyColumns = countEmptyColumns(initialState);
  return {
    longestFoundationDrought: 0,
    zeroProgressMoves: 0,
    cascadeCount: 0,
    maxCascadeSize: 0,
    avgCascadeSize: 0,
    movesToPark: 0,
    movesFromPark: 0,
    maxConsecutiveParkOccupiedMoves: initialState.park ? 1 : 0,
    parkBlockedMinorOpportunities: countParkBlockedMinorOpportunities(initialState),
    avgEmptyColumns: emptyColumns,
    minEmptyColumns: emptyColumns,
    maxEmptyColumns: emptyColumns,
    firstEmptyColumnMove: emptyColumns > 0 ? 0 : null,
  };
}

function analyzeSolutionReplay(initialState: State, path: string[]): ReplayMetrics {
  let state = initialState;
  let longestFoundationDrought = 0;
  let currentFoundationDrought = 0;
  let zeroProgressMoves = 0;
  let cascadeCount = 0;
  let cascadeTotal = 0;
  let maxCascadeSize = 0;
  let movesToPark = 0;
  let movesFromPark = 0;
  let currentParkOccupiedMoves = state.park ? 1 : 0;
  let maxConsecutiveParkOccupiedMoves = currentParkOccupiedMoves;
  let parkBlockedMinorOpportunities = countParkBlockedMinorOpportunities(state);
  let emptyColumnTotal = countEmptyColumns(state);
  let minEmptyColumns = emptyColumnTotal;
  let maxEmptyColumns = emptyColumnTotal;
  let firstEmptyColumnMove: number | null = emptyColumnTotal > 0 ? 0 : null;

  for (let index = 0; index < path.length; index++) {
    const move = parseFormattedMove(state, path[index]);
    const beforeProgress = progress(state);
    if (move.toType === "park") movesToPark++;
    if (move.fromType === "park") movesFromPark++;

    state = applyMove(state, move);

    const progressDelta = progress(state) - beforeProgress;
    if (progressDelta === 0) {
      zeroProgressMoves++;
      currentFoundationDrought++;
      longestFoundationDrought = Math.max(longestFoundationDrought, currentFoundationDrought);
    } else {
      currentFoundationDrought = 0;
      cascadeCount++;
      cascadeTotal += progressDelta;
      maxCascadeSize = Math.max(maxCascadeSize, progressDelta);
    }

    if (state.park) {
      currentParkOccupiedMoves++;
      maxConsecutiveParkOccupiedMoves = Math.max(maxConsecutiveParkOccupiedMoves, currentParkOccupiedMoves);
    } else {
      currentParkOccupiedMoves = 0;
    }

    parkBlockedMinorOpportunities += countParkBlockedMinorOpportunities(state);
    const emptyColumns = countEmptyColumns(state);
    emptyColumnTotal += emptyColumns;
    minEmptyColumns = Math.min(minEmptyColumns, emptyColumns);
    maxEmptyColumns = Math.max(maxEmptyColumns, emptyColumns);
    if (firstEmptyColumnMove === null && emptyColumns > 0) firstEmptyColumnMove = index + 1;
  }

  return {
    longestFoundationDrought,
    zeroProgressMoves,
    cascadeCount,
    maxCascadeSize,
    avgCascadeSize: cascadeCount === 0 ? 0 : cascadeTotal / cascadeCount,
    movesToPark,
    movesFromPark,
    maxConsecutiveParkOccupiedMoves,
    parkBlockedMinorOpportunities,
    avgEmptyColumns: emptyColumnTotal / (path.length + 1),
    minEmptyColumns,
    maxEmptyColumns,
    firstEmptyColumnMove,
  };
}

function parseFormattedMove(state: State, text: string): ParsedMove {
  const [from, to] = text.split(":");
  const [fromType, fromIndex] = from.split(",");
  const [toType, toIndex] = to.split(",");
  const move = {
    fromType: fromType as Move["fromType"],
    fromIndex: Number(fromIndex),
    toType: toType as Move["toType"],
    toIndex: Number(toIndex),
  };
  const card = getSourceCard(state, move.fromType, move.fromIndex);
  if (!card) throw new Error(`Move has no source card: ${text}`);
  return { ...move, card };
}

function countEmptyColumns(state: State): number {
  return state.tableau.filter((column) => column.length === 0).length;
}

function countParkBlockedMinorOpportunities(state: State): number {
  if (!state.park) return 0;
  let blocked = 0;
  for (const column of state.tableau) {
    const card = column[column.length - 1];
    if (!card) continue;
    const decoded = decodeCard(card);
    if (decoded.kind === "minor" && decoded.rank === state.minor[decoded.suitIndex] + 1) blocked++;
  }
  return blocked;
}

function initialBlockerScore(state: State): number {
  const neededCards = new Set<string>();
  for (let suitIndex = 0; suitIndex < state.minor.length; suitIndex++) {
    const nextRank = state.minor[suitIndex] + 1;
    if (nextRank <= 13) neededCards.add(`${Object.values(SUIT_CODES)[suitIndex]}${nextRank}`);
  }
  if (state.majorLow + 1 < state.majorHigh) neededCards.add(`M${state.majorLow + 1}`);
  if (state.majorHigh - 1 > state.majorLow) neededCards.add(`M${state.majorHigh - 1}`);

  let blockers = 0;
  for (const column of state.tableau) {
    for (let index = 0; index < column.length; index++) {
      if (neededCards.has(column[index])) blockers += column.length - index - 1;
    }
  }
  return blockers;
}
