import {
  applyManualOnly,
  applyMove,
  canMoveToFoundation,
  canStackOn,
  formatMove,
  getSourceCard,
  getValidMoves,
  hashState,
  isGoalState,
  parseBoard,
  replay,
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

    for (const move of orderMoves(current.state, getValidMoves(current.state))) {
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
