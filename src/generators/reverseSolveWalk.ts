import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyManualOnly,
  applyMove,
  autoMoveFoundations,
  cloneState,
  formatMove,
  getSourceCard,
  getValidMoves,
  hashState,
  isGoalState,
  parseBoard,
  replay,
  serializeBoard,
  type Move,
  type State,
} from "../game.ts";
import { validateInitialDeal } from "../dealValidation.ts";
import { solveBoard, type SolveMetrics } from "../solver.ts";
import type { GenerateDealOptions, GenerateDealResult, GenerationStrategy } from "../generator.ts";
import { COLUMN_SIZES, choose, createRandom, hasInitialShape, type Random } from "./shared.ts";
import { parkLockedMinorCascadeStrategy } from "./parkLockedMinorCascade.ts";

const STRATEGY_NAME = "reverse-solve-walk";
const DEFAULT_MAX_ATTEMPTS = 3;
const MIN_REVERSE_STEPS = 28;
const MAX_REVERSE_STEPS = 72;
const CANDIDATES_PER_ATTEMPT = 1;
const MAX_WALK_TRIES = 24;
const MACRO_DEPTHS = [3, 4, 5];
const TARGET_DEAL_PATHS = [
  "data/deals/deal-01.txt",
  "data/deals/deal-02.txt",
  "data/deals/deal-03.txt",
  "data/deals/deal-04.txt",
  "data/deals/deal-05.txt",
  "data/deals/deal-06.txt",
  "data/deals/deal-07.txt",
  "data/deals/deal-08.txt",
  "data/deals/deal-09.txt",
  "data/deals/deal-10.txt",
  "data/deals/deal-11.txt",
];

type RejectionReason =
  | "base-error"
  | "walk-stuck"
  | "shape"
  | "auto-move"
  | "validation"
  | "proof"
  | "unsolved";

type Candidate = {
  state: State;
  proofPath: Move[];
  baseSource: string;
  reverseSteps: number;
  score: number;
  solve: {
    pathLength: number;
    visited: number;
    metrics: SolveMetrics;
  };
};

type BaseDeal = {
  state: State;
  proofPath: Move[];
  source: string;
};

const targetBaseCache = new Map<string, BaseDeal>();

const TARGET = {
  pathLength: 104.5,
  visited: 20350,
  drought: 19.7,
  maxCascade: 14.5,
  parkMoves: 11.2,
  avgEmptyColumns: 2.17,
  initialBlockers: 19.1,
};

const METRIC_WEIGHTS = {
  pathLength: 3.2,
  visited: 2.6,
  drought: 1.3,
  parkMoves: 1.1,
  avgEmptyColumns: 0.9,
  maxCascade: 0.8,
  initialBlockers: 0.8,
};

export const reverseSolveWalkStrategy: GenerationStrategy = {
  name: STRATEGY_NAME,
  generate: generateReverseSolveWalkDeal,
};

export function generateReverseSolveWalkDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  const seed = String(options.seed ?? "default");
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const rejectionCounts = emptyRejectionCounts();
  let best: Candidate | null = null;
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsUsed = attempt;
    for (let candidateIndex = 0; candidateIndex < CANDIDATES_PER_ATTEMPT; candidateIndex++) {
      const random = createRandom(`${seed}:${attempt}:${candidateIndex}`);
      const base = buildBase(seed, attempt, candidateIndex, rejectionCounts);
      if (!base) continue;

      const targetSteps = randomInt(random, MIN_REVERSE_STEPS, MAX_REVERSE_STEPS);
      const walked = buildReverseWalk(base.state, base.proofPath, random, targetSteps) ?? {
        state: base.state,
        proofPath: base.proofPath,
        reverseSteps: 0,
      };
      if (walked.reverseSteps === 0) {
        rejectionCounts["walk-stuck"]++;
      }

      const rejection = validateCandidate(walked.state, walked.proofPath);
      if (rejection) {
        rejectionCounts[rejection]++;
        continue;
      }

      const solved = solveBoard(serializeBoard(walked.state), { maxVisited: 250_000 });
      if (!solved.path) {
        rejectionCounts.unsolved++;
        continue;
      }

      const candidate: Candidate = {
        state: walked.state,
        proofPath: walked.proofPath,
        baseSource: base.source,
        reverseSteps: walked.reverseSteps,
        score: scoreCandidate(solved.path.length, solved.visited, solved.metrics),
        solve: {
          pathLength: solved.path.length,
          visited: solved.visited,
          metrics: solved.metrics,
        },
      };

      if (!best || candidate.score < best.score) best = candidate;
    }
  }

  if (!best) {
    throw new Error(
      `Unable to generate a reverse-solve deal after ${maxAttempts.toLocaleString()} attempts: ${JSON.stringify(
        rejectionCounts,
      )}`,
    );
  }

  return {
    board: serializeBoard(best.state),
    seed,
    attempts: attemptsUsed,
    strategy: options.strategy ?? STRATEGY_NAME,
    metadata: {
      proof: STRATEGY_NAME,
      proofPath: best.proofPath.map(formatMove),
      reverseSteps: best.reverseSteps,
      baseSource: best.baseSource,
      candidateScore: best.score,
      candidateMetrics: summarizeMetrics(best.solve.pathLength, best.solve.visited, best.solve.metrics),
      rejectionCounts,
    },
  };
}

function buildBase(
  seed: string,
  attempt: number,
  candidateIndex: number,
  rejectionCounts: Record<RejectionReason, number>,
): BaseDeal | null {
  const target = buildTargetBase(hashText(`${seed}:${attempt}:${candidateIndex}`));
  if (target) return target;

  try {
    const generated = parkLockedMinorCascadeStrategy.generate({
      seed: `${seed}:base:${attempt}:${candidateIndex}`,
      strategy: "park-locked-minor-cascade",
      maxAttempts: 500,
    });
    const proofPath = parseProofPath(generated.metadata?.proofPath);
    return {
      state: parseBoard(generated.board, { autoMove: false }),
      proofPath,
      source: "park-locked-minor-cascade",
    };
  } catch {
    rejectionCounts["base-error"]++;
    return null;
  }
}

function buildTargetBase(index: number): BaseDeal | null {
  const path = TARGET_DEAL_PATHS[index % TARGET_DEAL_PATHS.length];
  const cached = targetBaseCache.get(path);
  if (cached) return cloneBase(cached);

  try {
    const board = readFileSync(join(process.cwd(), path), "utf8");
    const solved = solveBoard(board);
    if (!solved.path) return null;
    const base = {
      state: parseBoard(board, { autoMove: false }),
      proofPath: solved.path.map(parseMove),
      source: path,
    };
    targetBaseCache.set(path, base);
    return cloneBase(base);
  } catch {
    return null;
  }
}

function cloneBase(base: BaseDeal): BaseDeal {
  return {
    state: cloneState(base.state),
    proofPath: base.proofPath.slice(),
    source: base.source,
  };
}

function buildReverseWalk(
  baseState: State,
  baseProofPath: Move[],
  random: Random,
  targetSteps: number,
): { state: State; proofPath: Move[]; reverseSteps: number } | null {
  let state = cloneState(baseState);
  const inversePath: Move[] = [];
  const seen = new Set<string>([hashState(state)]);
  let idleTries = 0;

  while (inversePath.length < targetSteps && idleTries < MAX_WALK_TRIES) {
    const macro = chooseMacro(random, state, seen);
    if (!macro) {
      idleTries++;
      continue;
    }

    state = macro.state;
    seen.add(hashState(state));
    inversePath.unshift(...macro.inverseMoves);
    idleTries = 0;
  }

  if (inversePath.length < MIN_REVERSE_STEPS) return null;

  return {
    state,
    proofPath: [...inversePath, ...baseProofPath],
    reverseSteps: inversePath.length,
  };
}

function chooseMacro(
  random: Random,
  state: State,
  seen: Set<string>,
): { state: State; inverseMoves: Move[] } | null {
  const depths = shuffle(random, MACRO_DEPTHS);
  for (const depth of depths) {
    const macros = collectMacros(state, depth, seen, 18);
    if (macros.length > 0) return choose(random, macros);
  }
  return null;
}

function collectMacros(
  state: State,
  depth: number,
  seen: Set<string>,
  limit: number,
): { state: State; inverseMoves: Move[] }[] {
  const results: { state: State; inverseMoves: Move[] }[] = [];

  function visit(current: State, remaining: number, inverseMoves: Move[], localSeen: Set<string>): void {
    if (results.length >= limit) return;
    if (remaining === 0) {
      if (!hasInitialShape(current)) return;
      if (hashState(autoMoveFoundations(current)) !== hashState(current)) return;
      if (seen.has(hashState(current))) return;
      results.push({ state: current, inverseMoves });
      return;
    }

    const currentDistance = columnSizeDistance(current);
    for (const move of getNoCascadeMoves(current)) {
      const next = applyMove(current, move);
      const nextHash = hashState(next);
      if (localSeen.has(nextHash)) continue;
      const nextDistance = columnSizeDistance(next);
      if (nextDistance > remaining) continue;
      if (remaining <= currentDistance && nextDistance >= currentDistance) continue;

      const inverse = inverseMove(next, move);
      if (!inverse) continue;

      localSeen.add(nextHash);
      visit(next, remaining - 1, [inverse, ...inverseMoves], localSeen);
      localSeen.delete(nextHash);
    }
  }

  visit(state, depth, [], new Set([hashState(state)]));
  return results;
}

function getNoCascadeMoves(state: State): Move[] {
  return getValidMoves(state).filter((move) => {
    const manual = applyManualOnly(state, move);
    const automatic = applyMove(state, move);
    return hashState(manual) === hashState(automatic);
  });
}

function inverseMove(stateAfterMove: State, move: Move): Move | null {
  const inverseFromType = move.toType;
  const inverseFromIndex = move.toType === "park" ? 0 : move.toIndex;
  const inverseToType = move.fromType;
  const inverseToIndex = move.fromType === "park" ? 0 : move.fromIndex;
  const card = getSourceCard(stateAfterMove, inverseFromType, inverseFromIndex);
  if (!card) return null;
  const inverse: Move = {
    fromType: inverseFromType,
    fromIndex: inverseFromIndex,
    toType: inverseToType,
    toIndex: inverseToIndex,
  };
  try {
    const restored = applyMove(stateAfterMove, inverse);
    const manual = applyManualOnly(stateAfterMove, inverse);
    if (hashState(restored) !== hashState(manual)) return null;
    return getSourceCard(stateAfterMove, inverse.fromType, inverse.fromIndex) === card ? inverse : null;
  } catch {
    return null;
  }
}

function columnSizeDistance(state: State): number {
  return state.tableau.reduce((sum, column, index) => sum + Math.abs(column.length - COLUMN_SIZES[index]), 0);
}

function validateCandidate(state: State, proofPath: Move[]): RejectionReason | null {
  if (!hasInitialShape(state)) return "shape";
  if (hashState(autoMoveFoundations(state)) !== hashState(state)) return "auto-move";

  const validation = validateInitialDeal(serializeBoard(state));
  if (!validation.ok) return "validation";

  try {
    const final = replay(state, proofPath.map(formatMove));
    if (!isGoalState(final)) return "proof";
  } catch {
    return "proof";
  }

  return null;
}

function scoreCandidate(pathLength: number, visited: number, metrics: SolveMetrics): number {
  const parkMoves = (metrics.movesToPark + metrics.movesFromPark) / 2;
  return (
    METRIC_WEIGHTS.pathLength * normalizedDistance(pathLength, TARGET.pathLength) +
    METRIC_WEIGHTS.visited * normalizedDistance(Math.log10(visited + 1), Math.log10(TARGET.visited + 1)) +
    METRIC_WEIGHTS.drought * normalizedDistance(metrics.longestFoundationDrought, TARGET.drought) +
    METRIC_WEIGHTS.parkMoves * normalizedDistance(parkMoves, TARGET.parkMoves) +
    METRIC_WEIGHTS.avgEmptyColumns * normalizedDistance(metrics.avgEmptyColumns, TARGET.avgEmptyColumns) +
    METRIC_WEIGHTS.maxCascade * normalizedDistance(metrics.maxCascadeSize, TARGET.maxCascade) +
    METRIC_WEIGHTS.initialBlockers * normalizedDistance(metrics.initialBlockerScore, TARGET.initialBlockers)
  );
}

function normalizedDistance(value: number, target: number): number {
  return Math.abs(value - target) / Math.max(1, Math.abs(target));
}

function summarizeMetrics(pathLength: number, visited: number, metrics: SolveMetrics): Record<string, number> {
  return {
    pathLength,
    visited,
    peakFrontier: metrics.peakFrontier,
    longestFoundationDrought: metrics.longestFoundationDrought,
    maxCascadeSize: metrics.maxCascadeSize,
    movesToPark: metrics.movesToPark,
    movesFromPark: metrics.movesFromPark,
    avgEmptyColumns: metrics.avgEmptyColumns,
    initialBlockerScore: metrics.initialBlockerScore,
  };
}

function parseProofPath(value: unknown): Move[] {
  if (!Array.isArray(value)) throw new Error("Base strategy did not return a proofPath");
  return value.map((text) => parseMove(String(text)));
}

function parseMove(text: string): Move {
  const [from, to] = text.split(":");
  const [fromType, fromIndex] = from.split(",");
  const [toType, toIndex] = to.split(",");
  return {
    fromType: fromType as Move["fromType"],
    fromIndex: Number(fromIndex),
    toType: toType as Move["toType"],
    toIndex: Number(toIndex),
  };
}

function randomInt(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function shuffle<T>(random: Random, values: readonly T[]): T[] {
  const shuffled = values.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function emptyRejectionCounts(): Record<RejectionReason, number> {
  return {
    "base-error": 0,
    "walk-stuck": 0,
    shape: 0,
    "auto-move": 0,
    validation: 0,
    proof: 0,
    unsolved: 0,
  };
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
