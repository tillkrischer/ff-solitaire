export const COLUMN_SIZES = [7, 7, 7, 7, 7, 0, 7, 7, 7, 7, 7] as const;
export const CARD_COUNT = 70;
export const EMPTY = 255;

const NEXT_FOUNDATION_CARDS = [22, 34, 46, 58, 0, 21] as const;

const TARGET = {
  pathLength: 104.5,
  logVisited: Math.log10(20_350 + 1),
  drought: 19.7,
  maxCascade: 14.5,
  totalParkMoves: 22.2,
  avgEmptyColumns: 2.17,
  initialBlockers: 19.1,
  initialMoves: 24.7,
  avgNextDepth: 3.18,
  maxNextDepth: 5.36,
  stackAdjacency: 1.36,
  sameKindAdjacency: 11.55,
};

export type BulkSearchOptions = {
  seed: string;
  maxVisited: number;
  beam: number;
  trimEvery: number;
};

export type WorkerChunkRequest = BulkSearchOptions & {
  startAttempt: number;
  attempts: number;
};

export type WorkerChunkResult = {
  startAttempt: number;
  attempts: number;
  elapsedMs: number;
  counters: SearchCounters;
  candidates: Candidate[];
};

export type SearchCounters = {
  attempts: number;
  validationRejected: number;
  cheapProfileRejected: number;
  solverAttempts: number;
  solved: number;
  unsolved: number;
};

export type InitialProfile = {
  initialMoves: number;
  topEligibleNextCards: number;
  avgNextDepth: number;
  maxNextDepth: number;
  stackAdjacency: number;
  sameKindAdjacency: number;
  initialBlockers: number;
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

export type Candidate = {
  attempt: number;
  seed: string;
  board: string;
  boardHash: string;
  score: number;
  path: string[];
  visited: number;
  metrics: SolveMetrics;
  profile: InitialProfile;
};

type State = {
  columns: number[][];
  park: number;
  minor: [number, number, number, number];
  majorLow: number;
  majorHigh: number;
};

type Move = {
  fromType: 0 | 1;
  fromIndex: number;
  toType: 0 | 1;
  toIndex: number;
};

type SearchNode = {
  state: State;
  parent: number;
  move: Move | null;
  depth: number;
  priority: number;
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

export function runWorkerChunk(request: WorkerChunkRequest): WorkerChunkResult {
  const started = Date.now();
  const counters = emptyCounters();
  const candidates: Candidate[] = [];

  for (let offset = 0; offset < request.attempts; offset++) {
    const attempt = request.startAttempt + offset;
    counters.attempts++;
    const attemptSeed = `${request.seed}:${attempt}`;
    const state = buildRandomInitialState(createRandom(attemptSeed));

    if (hasAutomaticFoundationMove(state)) {
      counters.validationRejected++;
      continue;
    }

    const profile = analyzeInitialProfile(state);
    if (!passesCheapProfile(profile)) {
      counters.cheapProfileRejected++;
      continue;
    }

    counters.solverAttempts++;
    const solved = solve(state, request);
    if (!solved.path) {
      counters.unsolved++;
      continue;
    }

    counters.solved++;
    const board = serializeBoard(state);
    const metrics = combineMetrics(solved.searchMetrics, solved.visited, analyzeSolutionReplay(state, solved.path), state);
    candidates.push({
      attempt,
      seed: attemptSeed,
      board,
      boardHash: hashBoardText(board),
      score: scoreCandidate(solved.path.length, solved.visited, metrics, profile),
      path: solved.path.map(formatMove),
      visited: solved.visited,
      metrics,
      profile,
    });
  }

  return {
    startAttempt: request.startAttempt,
    attempts: request.attempts,
    elapsedMs: Date.now() - started,
    counters,
    candidates,
  };
}

export function emptyCounters(): SearchCounters {
  return {
    attempts: 0,
    validationRejected: 0,
    cheapProfileRejected: 0,
    solverAttempts: 0,
    solved: 0,
    unsolved: 0,
  };
}

export function addCounters(target: SearchCounters, source: SearchCounters): void {
  target.attempts += source.attempts;
  target.validationRejected += source.validationRejected;
  target.cheapProfileRejected += source.cheapProfileRejected;
  target.solverAttempts += source.solverAttempts;
  target.solved += source.solved;
  target.unsolved += source.unsolved;
}

function buildRandomInitialState(random: Random): State {
  const cards = shuffle(random, allCards());
  const columns: number[][] = [];
  let cursor = 0;
  for (const size of COLUMN_SIZES) {
    columns.push(cards.slice(cursor, cursor + size));
    cursor += size;
  }
  return {
    columns,
    park: EMPTY,
    minor: [1, 1, 1, 1],
    majorLow: -1,
    majorHigh: 22,
  };
}

function solve(
  initialState: State,
  options: { maxVisited: number; beam: number; trimEvery: number },
): { path: Move[] | null; visited: number; searchMetrics: SearchMetrics } {
  let nodes: SearchNode[] = [
    {
      state: autoMoveFoundations(cloneState(initialState)),
      parent: -1,
      move: null,
      depth: 0,
      priority: stateScore(initialState, 0),
    },
  ];
  const queue = new MaxHeap<number>((nodeIndex) => nodes[nodeIndex].priority);
  const visited = new Set<string>();
  queue.push(0);
  const searchMetrics: SearchMetrics = {
    peakFrontier: 1,
    generatedMoves: 0,
    maxBranching: 0,
    duplicateSkips: 0,
    trimCount: 0,
    trimmedNodes: 0,
  };

  let explored = 0;
  while (queue.length > 0) {
    searchMetrics.peakFrontier = Math.max(searchMetrics.peakFrontier, queue.length);
    const currentIndex = queue.pop();
    if (currentIndex === undefined) break;
    const current = nodes[currentIndex];
    const hash = hashState(current.state);
    if (visited.has(hash)) continue;
    visited.add(hash);
    explored++;

    if (isGoalState(current.state)) {
      return { path: reconstructPath(nodes, currentIndex), visited: explored, searchMetrics };
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
      const depth = current.depth + 1;
      nodes.push({
        state: nextState,
        parent: currentIndex,
        move,
        depth,
        priority: stateScore(nextState, depth),
      });
      queue.push(nodes.length - 1);
    }

    if (explored % options.trimEvery === 0 || queue.length > options.beam * 4) {
      const trimmed = queue.keepBest(options.beam);
      if (trimmed > 0) {
        searchMetrics.trimCount++;
        searchMetrics.trimmedNodes += trimmed;
        nodes = compactSearchNodes(nodes, queue, currentIndex);
      }
    }
  }

  return { path: null, visited: explored, searchMetrics };
}

function compactSearchNodes(
  nodes: SearchNode[],
  queue: MaxHeap<number>,
  currentIndex: number,
): SearchNode[] {
  const retained = new Set<number>();
  const retainAncestors = (startIndex: number): void => {
    let index = startIndex;
    while (index !== -1 && !retained.has(index)) {
      retained.add(index);
      index = nodes[index].parent;
    }
  };

  retainAncestors(currentIndex);
  for (const queuedIndex of queue.snapshot()) {
    retainAncestors(queuedIndex);
  }

  const indexMap = new Map<number, number>();
  const compacted: SearchNode[] = [];
  for (let index = 0; index < nodes.length; index++) {
    if (!retained.has(index)) continue;
    indexMap.set(index, compacted.length);
    compacted.push(nodes[index]);
  }

  for (const node of compacted) {
    if (node.parent === -1) continue;
    const parent = indexMap.get(node.parent);
    if (parent === undefined) throw new Error("Compacted search node is missing its parent");
    node.parent = parent;
  }

  queue.mapValues((index) => {
    const mapped = indexMap.get(index);
    if (mapped === undefined) throw new Error("Compacted search queue is missing a node");
    return mapped;
  });

  const mappedCurrentIndex = indexMap.get(currentIndex);
  if (mappedCurrentIndex === undefined) throw new Error("Compacted search is missing the current node");
  return compacted;
}

function reconstructPath(nodes: SearchNode[], nodeIndex: number): Move[] {
  const path: Move[] = [];
  let currentIndex = nodeIndex;
  while (currentIndex !== -1) {
    const node = nodes[currentIndex];
    if (node.move) path.push(node.move);
    currentIndex = node.parent;
  }
  path.reverse();
  return path;
}

function getValidMoves(state: State): Move[] {
  const moves: Move[] = [];
  const sources: Move[] = [];
  if (state.park !== EMPTY) sources.push({ fromType: 1, fromIndex: 0, toType: 0, toIndex: -1 });
  for (let index = 0; index < state.columns.length; index++) {
    if (state.columns[index].length > 0) sources.push({ fromType: 0, fromIndex: index, toType: 0, toIndex: -1 });
  }

  for (const source of sources) {
    const card = getSourceCard(state, source.fromType, source.fromIndex);
    if (card === EMPTY) continue;
    if (source.fromType === 0 && state.park === EMPTY) {
      moves.push({ ...source, toType: 1, toIndex: 0 });
    }
    for (let toIndex = 0; toIndex < state.columns.length; toIndex++) {
      if (source.fromType === 0 && source.fromIndex === toIndex) continue;
      const targetColumn = state.columns[toIndex];
      const target = targetColumn[targetColumn.length - 1] ?? EMPTY;
      if (target === EMPTY || canStackOn(card, target)) {
        moves.push({ ...source, toType: 0, toIndex });
      }
    }
  }
  return moves;
}

function orderMoves(state: State, moves: Move[]): Move[] {
  return moves.sort((a, b) => moveScore(state, b) - moveScore(state, a));
}

function moveScore(state: State, move: Move): number {
  const card = getSourceCard(state, move.fromType, move.fromIndex);
  if (card === EMPTY) return -1000;
  let score = 0;
  const fromColumn = move.fromType === 0 ? state.columns[move.fromIndex] : null;
  const toColumn = move.toType === 0 ? state.columns[move.toIndex] : null;
  if (move.toType === 0 && toColumn?.length === 0) score += 15;
  if (move.fromType === 1) score += 20;
  if (move.toType === 1) score -= 8;
  if (fromColumn?.length === 1) score += 18;
  if (move.toType === 0 && toColumn && toColumn.length > 0) score += 8;
  if (canMoveToFoundation(applyManualOnly(state, move), card, move.toType === 1)) score += 30;
  return score;
}

function stateScore(state: State, depth: number): number {
  let score = progress(state) * 1000;
  score += state.columns.filter((column) => column.length === 0).length * 90;
  score += state.park === EMPTY ? 35 : -40;
  score -= depth * 3;

  for (const column of state.columns) {
    score -= column.length;
    for (let index = 0; index < column.length - 1; index++) {
      if (canStackOn(column[index + 1], column[index])) score += 8;
    }
    const top = column[column.length - 1] ?? EMPTY;
    if (top !== EMPTY && canMoveToFoundation(state, top, false)) score += 60;
  }
  if (state.park !== EMPTY && canMoveToFoundation(state, state.park, true)) score += 80;
  return score;
}

function applyMove(state: State, move: Move): State {
  return autoMoveFoundations(applyManualOnly(state, move));
}

function applyManualOnly(state: State, move: Move): State {
  const next = cloneState(state);
  let card = EMPTY;
  if (move.fromType === 1) {
    card = next.park;
    next.park = EMPTY;
  } else {
    card = next.columns[move.fromIndex].pop() ?? EMPTY;
  }
  if (card === EMPTY) throw new Error(`Move has no source card: ${formatMove(move)}`);
  if (move.toType === 1) {
    if (next.park !== EMPTY) throw new Error("Cannot move to occupied park");
    next.park = card;
  } else {
    next.columns[move.toIndex].push(card);
  }
  return next;
}

function autoMoveFoundations(input: State): State {
  const state = cloneState(input);
  let changed = true;
  while (changed) {
    changed = false;
    if (state.park !== EMPTY && canMoveToFoundation(state, state.park, true)) {
      moveCardToFoundation(state, state.park);
      state.park = EMPTY;
      changed = true;
      continue;
    }
    for (const column of state.columns) {
      const card = column[column.length - 1] ?? EMPTY;
      if (card !== EMPTY && canMoveToFoundation(state, card, false)) {
        column.pop();
        moveCardToFoundation(state, card);
        changed = true;
        break;
      }
    }
  }
  return state;
}

function hasAutomaticFoundationMove(state: State): boolean {
  if (state.park !== EMPTY && canMoveToFoundation(state, state.park, true)) return true;
  return state.columns.some((column) => {
    const card = column[column.length - 1] ?? EMPTY;
    return card !== EMPTY && canMoveToFoundation(state, card, false);
  });
}

function canMoveToFoundation(state: State, card: number, fromPark: boolean): boolean {
  if (isMajor(card)) return card === state.majorLow + 1 || card === state.majorHigh - 1;
  if (!fromPark && state.park !== EMPTY) return false;
  return minorRank(card) === state.minor[minorSuit(card)] + 1;
}

function moveCardToFoundation(state: State, card: number): void {
  if (isMajor(card)) {
    if (card === state.majorLow + 1) state.majorLow = card;
    else if (card === state.majorHigh - 1) state.majorHigh = card;
    else throw new Error(`Illegal major foundation move: ${cardToString(card)}`);
    return;
  }
  const suit = minorSuit(card);
  const rank = minorRank(card);
  if (rank !== state.minor[suit] + 1) throw new Error(`Illegal minor foundation move: ${cardToString(card)}`);
  state.minor[suit] = rank;
}

function canStackOn(card: number, target: number): boolean {
  if (isMajor(card) !== isMajor(target)) return false;
  if (isMajor(card)) return Math.abs(card - target) === 1;
  return minorSuit(card) === minorSuit(target) && Math.abs(minorRank(card) - minorRank(target)) === 1;
}

function getSourceCard(state: State, type: 0 | 1, index: number): number {
  if (type === 1) return state.park;
  return state.columns[index][state.columns[index].length - 1] ?? EMPTY;
}

function isGoalState(state: State): boolean {
  return (
    state.park === EMPTY &&
    state.columns.every((column) => column.length === 0) &&
    state.minor.every((rank) => rank === 13) &&
    state.majorLow + (21 - state.majorHigh) + 2 === 22
  );
}

function progress(state: State): number {
  return state.minor[0] + state.minor[1] + state.minor[2] + state.minor[3] + state.majorLow + 1 + (22 - state.majorHigh);
}

function analyzeSolutionReplay(initialState: State, path: Move[]): ReplayMetrics {
  let state = cloneState(initialState);
  let longestFoundationDrought = 0;
  let currentFoundationDrought = 0;
  let zeroProgressMoves = 0;
  let cascadeCount = 0;
  let cascadeTotal = 0;
  let maxCascadeSize = 0;
  let movesToPark = 0;
  let movesFromPark = 0;
  let currentParkOccupiedMoves = state.park !== EMPTY ? 1 : 0;
  let maxConsecutiveParkOccupiedMoves = currentParkOccupiedMoves;
  let parkBlockedMinorOpportunities = countParkBlockedMinorOpportunities(state);
  let emptyColumnTotal = countEmptyColumns(state);
  let minEmptyColumns = emptyColumnTotal;
  let maxEmptyColumns = emptyColumnTotal;
  let firstEmptyColumnMove: number | null = emptyColumnTotal > 0 ? 0 : null;

  for (let index = 0; index < path.length; index++) {
    const move = path[index];
    const beforeProgress = progress(state);
    if (move.toType === 1) movesToPark++;
    if (move.fromType === 1) movesFromPark++;
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

    if (state.park !== EMPTY) {
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
    initialBlockerScore: countInitialBlockers(initialState),
  };
}

function countEmptyColumns(state: State): number {
  return state.columns.filter((column) => column.length === 0).length;
}

function countParkBlockedMinorOpportunities(state: State): number {
  if (state.park === EMPTY) return 0;
  let blocked = 0;
  for (const column of state.columns) {
    const card = column[column.length - 1] ?? EMPTY;
    if (card !== EMPTY && !isMajor(card) && minorRank(card) === state.minor[minorSuit(card)] + 1) blocked++;
  }
  return blocked;
}

function analyzeInitialProfile(state: State): InitialProfile {
  const nextDepths = NEXT_FOUNDATION_CARDS.map((card) => cardDepth(state, card));
  const stackCounts = countStackAdjacencies(state);
  return {
    initialMoves: getValidMoves(state).length,
    topEligibleNextCards: nextDepths.filter((depth) => depth === 0).length,
    avgNextDepth: average(nextDepths),
    maxNextDepth: Math.max(...nextDepths),
    stackAdjacency: stackCounts.stackAdjacency,
    sameKindAdjacency: stackCounts.sameKindAdjacency,
    initialBlockers: countInitialBlockers(state),
  };
}

function passesCheapProfile(profile: InitialProfile): boolean {
  return (
    profile.topEligibleNextCards === 0 &&
    profile.initialMoves >= 18 &&
    profile.initialMoves <= 32 &&
    profile.avgNextDepth >= 2.25 &&
    profile.avgNextDepth <= 4.75 &&
    profile.maxNextDepth >= 4 &&
    profile.maxNextDepth <= 7 &&
    profile.stackAdjacency <= 5 &&
    profile.sameKindAdjacency >= 5 &&
    profile.sameKindAdjacency <= 20 &&
    profile.initialBlockers >= 12 &&
    profile.initialBlockers <= 32
  );
}

function cardDepth(state: State, card: number): number {
  for (const column of state.columns) {
    const index = column.indexOf(card);
    if (index !== -1) return column.length - index - 1;
  }
  throw new Error(`Card is missing from tableau: ${cardToString(card)}`);
}

function countStackAdjacencies(state: State): { stackAdjacency: number; sameKindAdjacency: number } {
  let stackAdjacency = 0;
  let sameKindAdjacency = 0;
  for (const column of state.columns) {
    for (let index = 0; index < column.length - 1; index++) {
      const below = column[index];
      const above = column[index + 1];
      if (canStackOn(above, below)) stackAdjacency++;
      if (isMajor(below) && isMajor(above)) {
        sameKindAdjacency++;
      } else if (!isMajor(below) && !isMajor(above) && minorSuit(below) === minorSuit(above)) {
        sameKindAdjacency++;
      }
    }
  }
  return { stackAdjacency, sameKindAdjacency };
}

function countInitialBlockers(state: State): number {
  let blockers = 0;
  for (const neededCard of NEXT_FOUNDATION_CARDS) {
    blockers += cardDepth(state, neededCard);
  }
  return blockers;
}

function scoreCandidate(pathLength: number, visited: number, metrics: SolveMetrics, profile: InitialProfile): number {
  const totalParkMoves = metrics.movesToPark + metrics.movesFromPark;
  return (
    2.8 * normalizedDistance(pathLength, TARGET.pathLength) +
    2.0 * normalizedDistance(Math.log10(visited + 1), TARGET.logVisited) +
    1.2 * normalizedDistance(metrics.longestFoundationDrought, TARGET.drought) +
    1.0 * normalizedDistance(totalParkMoves, TARGET.totalParkMoves) +
    0.9 * normalizedDistance(metrics.avgEmptyColumns, TARGET.avgEmptyColumns) +
    0.8 * normalizedDistance(metrics.maxCascadeSize, TARGET.maxCascade) +
    0.8 * normalizedDistance(metrics.initialBlockerScore, TARGET.initialBlockers) +
    0.4 * normalizedDistance(profile.initialMoves, TARGET.initialMoves) +
    0.5 * normalizedDistance(profile.avgNextDepth, TARGET.avgNextDepth) +
    0.4 * normalizedDistance(profile.maxNextDepth, TARGET.maxNextDepth) +
    0.4 * normalizedDistance(profile.stackAdjacency, TARGET.stackAdjacency) +
    0.3 * normalizedDistance(profile.sameKindAdjacency, TARGET.sameKindAdjacency)
  );
}

function cloneState(state: State): State {
  return {
    columns: state.columns.map((column) => column.slice()),
    park: state.park,
    minor: state.minor.slice() as [number, number, number, number],
    majorLow: state.majorLow,
    majorHigh: state.majorHigh,
  };
}

function hashState(state: State): string {
  let hash = `${state.majorLow},${state.majorHigh},${state.minor.join(",")},${state.park}|`;
  for (const column of state.columns) {
    for (const card of column) hash += String.fromCharCode(card + 1);
    hash += "\u0080";
  }
  return hash;
}

function hashBoardText(board: string): string {
  let hash = 2166136261;
  for (let index = 0; index < board.length; index++) {
    hash ^= board.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function serializeBoard(state: State): string {
  return [
    state.majorLow,
    state.majorHigh,
    state.minor.join(","),
    state.park === EMPTY ? "." : cardToString(state.park),
    ...state.columns.map((column) => column.map(cardToString).join(".")),
  ].join("|");
}

function formatMove(move: Move): string {
  return `${move.fromType === 0 ? "column" : "park"},${move.fromIndex}:${move.toType === 0 ? "column" : "park"},${move.toIndex}`;
}

function allCards(): number[] {
  return Array.from({ length: CARD_COUNT }, (_, index) => index);
}

function cardToString(card: number): string {
  if (isMajor(card)) return `M${card}`;
  const suitCodes = ["C", "S", "A", "T"];
  return `${suitCodes[minorSuit(card)]}${minorRank(card)}`;
}

function isMajor(card: number): boolean {
  return card < 22;
}

function minorSuit(card: number): number {
  return Math.floor((card - 22) / 12);
}

function minorRank(card: number): number {
  return ((card - 22) % 12) + 2;
}

type Random = () => number;

function createRandom(seed: string): Random {
  let state = hashSeed(seed);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash;
}

function shuffle<T>(random: Random, values: T[]): T[] {
  const shuffled = values.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizedDistance(value: number, target: number): number {
  return Math.abs(value - target) / Math.max(1, Math.abs(target));
}

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
    if (last !== undefined && this.values.length > 0) {
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
    for (let index = Math.floor(this.values.length / 2); index >= 0; index--) {
      this.sinkDown(index);
    }
    return trimmed;
  }

  snapshot(): T[] {
    return this.values.slice();
  }

  mapValues(mapper: (value: T) => T): void {
    for (let index = 0; index < this.values.length; index++) {
      this.values[index] = mapper(this.values[index]);
    }
    for (let index = Math.floor(this.values.length / 2); index >= 0; index--) {
      this.sinkDown(index);
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
      if (left < this.values.length && this.score(this.values[left]) > this.score(this.values[best])) best = left;
      if (right < this.values.length && this.score(this.values[right]) > this.score(this.values[best])) best = right;
      if (best === index) return;
      [this.values[index], this.values[best]] = [this.values[best], this.values[index]];
      index = best;
    }
  }
}
