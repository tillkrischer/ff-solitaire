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
const TARGET_DEALS = [
  {
    source: "data/deals/deal-01.txt",
    board:
      "-1|22|1,1,1,1|.|M9.A13.M3.C13.S3.S8.C10|C4.T10.C9.T9.C7.M12.M7|M17.A5.A3.C5.S2.T13.S5|M18.M4.A2.S7.M20.M19.M10|T8.M15.T11.A8.C2.M0.M2||M14.T12.T6.A12.T7.M6.M1|S13.C12.A6.M21.S12.M5.A11|S10.S4.C11.M11.M16.T3.A9|C6.S11.C8.T2.T4.S6.A10|C3.M13.A4.M8.S9.A7.T5",
  },
  {
    source: "data/deals/deal-02.txt",
    board:
      "-1|22|1,1,1,1|.|M5.A4.M19.A5.S8.T6.M18|M0.A6.M14.T2.M8.M10.S5|S3.C5.M17.A9.C7.S2.M13|C10.M15.T9.S10.M16.M2.T12|S11.M3.C6.M1.M11.C8.A13||S6.T11.M20.C4.T10.C2.A12|C3.C12.S7.T8.M4.M9.A7|C11.T5.S9.A2.A10.S4.T4|S13.S12.M7.A8.M12.M21.T13|T7.A3.C13.A11.C9.M6.T3",
  },
  {
    source: "data/deals/deal-03.txt",
    board:
      "-1|22|1,1,1,1|.|A13.S2.M19.M11.A5.M17.A10|A3.S11.S9.M7.S8.M1.T7|M6.C5.M5.T2.T10.A4.A9|T13.S3.M14.T12.M10.T3.C9|M16.M15.S6.S10.C2.M13.S5||C11.A8.M18.T9.M8.C6.T11|M21.A6.M3.A2.T4.C10.T5|C3.M12.M20.S13.A7.M2.C12|S12.C7.A12.C4.C13.T6.M4|A11.S4.C8.M9.M0.T8.S7",
  },
  {
    source: "data/deals/deal-04.txt",
    board:
      "-1|22|1,1,1,1|.|A7.C10.A10.S7.S3.C9.S6|S10.T4.S4.C6.A3.C8.M2|S5.M21.M6.T10.S13.S9.M17|T9.S8.M5.A8.T5.A6.M4|A4.A5.C4.M10.M0.C3.M20||M14.T7.T13.M8.C11.C5.M11|T8.A11.M12.A9.M3.C13.S12|T6.S2.C12.M19.A12.T11.M15|M1.M18.A2.S11.T3.C2.C7|M9.A13.T12.M13.M7.T2.M16",
  },
  {
    source: "data/deals/deal-05.txt",
    board:
      "-1|22|1,1,1,1|.|T6.M8.M18.M7.T11.S12.C3|A9.M2.A11.A5.T3.M6.S11|C5.M9.S8.T2.M21.S9.M11|M15.C2.M1.M19.M0.M10.S13|M4.C13.M12.C9.A13.A4.M14||T12.T7.S5.A7.S3.A12.T10|S6.C4.A2.A8.A10.M3.M17|T4.S4.C12.M5.A3.C7.S7|C6.C10.S10.T13.M13.T5.M16|T9.T8.S2.A6.C8.C11.M20",
  },
  {
    source: "data/deals/deal-06.txt",
    board:
      "-1|22|1,1,1,1|.|A10.C5.A13.C11.M13.T4.S8|M10.S11.M17.T8.M4.S6.M16|T10.M14.M20.C9.T9.S12.M11|S13.T13.T11.C4.M7.M5.C12|M1.M9.C10.C8.M12.T12.C13||A4.M3.S3.C2.A6.M21.C6|M8.A5.A12.M15.T3.A8.T6|M18.S10.M2.A9.S4.M19.S9|M6.S2.T2.A2.T5.S7.C3|A3.S5.A11.C7.A7.M0.T7",
  },
  {
    source: "data/deals/deal-07.txt",
    board:
      "-1|22|1,1,1,1|.|A7.C9.C11.T4.T12.M1.A5|A13.A6.A8.M7.S4.S11.A4|M4.S9.T11.A9.T13.A11.T9|M12.C2.C13.T6.M20.T7.S7|T10.M14.S12.M8.M18.S5.M6||S13.C10.C4.M15.C3.C7.M5|M10.C12.M0.A2.T5.M19.T3|M9.M2.M17.S6.M16.A10.T8|M3.M13.S2.S3.C8.C5.M11|C6.A3.A12.T2.M21.S10.S8",
  },
  {
    source: "data/deals/deal-08.txt",
    board:
      "-1|22|1,1,1,1|.|T10.A12.M16.S13.A11.A13.M8|M12.M13.A3.M19.C5.M6.A8|A4.T5.S11.M14.T2.S6.M4|S2.M11.C9.C10.M0.M20.C8|S8.M10.M15.T8.S7.M21.M7||S5.T7.S9.A6.S10.T13.C12|C7.M1.M18.C11.A2.M3.T4|C2.T11.C4.A9.A7.M2.T9|S12.A10.C3.M5.T6.T12.T3|M17.A5.S4.S3.M9.C6.C13",
  },
  {
    source: "data/deals/deal-09.txt",
    board:
      "-1|22|1,1,1,1|.|C6.C13.C12.S4.T13.T8.S11|A4.M2.M17.A10.M15.T5.M16|A3.M8.M3.C3.S12.A12.S8|M7.M0.C9.A13.A8.T3.C4|C11.T6.S13.T7.T9.M20.M1||M4.A9.M12.S5.A5.M9.M19|A11.S3.M13.C7.M14.T2.T12|M11.C8.S2.C2.C5.S7.S6|A6.A7.C10.M5.S9.M10.T10|S10.M18.M6.T11.M21.A2.T4",
  },
  {
    source: "data/deals/deal-10.txt",
    board:
      "-1|22|1,1,1,1|.|S4.M2.A6.T12.C7.A4.S5|A3.T2.C2.C13.S3.A11.T8|C6.C9.M0.M1.M5.M19.T9|C11.S10.A8.C12.T13.A7.C3|S13.A12.C10.M16.S2.M20.T6||T10.T5.S11.M13.M14.M18.M10|M17.M6.C5.T4.S8.S12.S7|M12.T3.C8.M8.S6.M3.C4|A2.A5.A13.S9.M7.M11.T11|M21.M15.A10.M4.A9.M9.T7",
  },
  {
    source: "data/deals/deal-11.txt",
    board:
      "-1|22|1,1,1,1|.|A6.A5.T12.S4.S6.T13.T4|T7.A2.T10.C3.T6.C2.A9|M7.T9.M6.M10.T3.A10.M12|C8.M4.C7.A12.S2.A11.M8|M21.M14.M19.A3.C9.M20.M11||A7.M0.T8.C10.T2.M5.C6|S11.M15.A8.S3.M2.C13.A13|S13.M18.C4.S8.C11.S12.M3|T5.M16.S10.M17.S9.S7.C12|T11.M1.A4.S5.C5.M9.M13",
  },
] as const;

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
  const targetDeal = TARGET_DEALS[index % TARGET_DEALS.length];
  const cached = targetBaseCache.get(targetDeal.source);
  if (cached) return cloneBase(cached);

  try {
    const solved = solveBoard(targetDeal.board);
    if (!solved.path) return null;
    const base = {
      state: parseBoard(targetDeal.board, { autoMove: false }),
      proofPath: solved.path.map(parseMove),
      source: targetDeal.source,
    };
    targetBaseCache.set(targetDeal.source, base);
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
