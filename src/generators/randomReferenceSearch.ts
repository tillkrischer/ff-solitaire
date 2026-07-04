import {
  INITIAL_STATE,
  canStackOn,
  decodeCard,
  getValidMoves,
  serializeBoard,
  type State,
} from "../game.ts";
import { expectedDealCards, validateInitialDeal } from "../dealValidation.ts";
import { solveBoard, type SolveMetrics, type SolveOptions } from "../solver.ts";
import type { GenerateDealOptions, GenerateDealResult, GenerationStrategy } from "../generator.ts";
import { COLUMN_SIZES, assertValidMaxAttempts, createRandom, type Random } from "./shared.ts";

const STRATEGY_NAME = "random-reference-search";
const DEFAULT_MAX_ATTEMPTS = 500;
const SOLVE_OPTIONS: SolveOptions = { maxVisited: 250_000 };
const NEXT_FOUNDATION_CARDS = ["C2", "S2", "A2", "T2", "M0", "M21"];

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

const ACCEPT_SCORE = 1.05;

type InitialProfile = {
  initialMoves: number;
  topEligibleNextCards: number;
  avgNextDepth: number;
  maxNextDepth: number;
  stackAdjacency: number;
  sameKindAdjacency: number;
  initialBlockers: number;
};

type Candidate = {
  board: string;
  profile: InitialProfile;
  path: string[];
  visited: number;
  metrics: SolveMetrics;
  score: number;
};

type RejectionReason = "validation" | "cheap-profile" | "unsolved";

export const randomReferenceSearchStrategy: GenerationStrategy = {
  name: STRATEGY_NAME,
  generate: generateRandomReferenceSearchDeal,
};

export function generateRandomReferenceSearchDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  const seed = String(options.seed ?? "default");
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  assertValidMaxAttempts(maxAttempts);

  const rejectionCounts: Record<RejectionReason, number> = {
    validation: 0,
    "cheap-profile": 0,
    unsolved: 0,
  };
  let best: Candidate | null = null;
  let solvedCandidates = 0;
  let solverAttempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const random = createRandom(`${seed}:${attempt}`);
    const state = buildRandomState(random);
    const board = serializeBoard(state);
    const validation = validateInitialDeal(board);
    if (!validation.ok) {
      rejectionCounts.validation++;
      continue;
    }

    const profile = analyzeInitialProfile(validation.state);
    if (!passesCheapProfile(profile)) {
      rejectionCounts["cheap-profile"]++;
      continue;
    }

    solverAttempts++;
    const solved = solveBoard(board, SOLVE_OPTIONS);
    if (!solved.path) {
      rejectionCounts.unsolved++;
      continue;
    }

    solvedCandidates++;
    const candidate: Candidate = {
      board,
      profile,
      path: solved.path,
      visited: solved.visited,
      metrics: solved.metrics,
      score: scoreCandidate(solved.path.length, solved.visited, solved.metrics, profile),
    };

    if (!best || candidate.score < best.score) best = candidate;
    if (candidate.score <= ACCEPT_SCORE) {
      return formatResult(seed, attempt, options.strategy ?? STRATEGY_NAME, candidate, {
        rejectionCounts,
        solvedCandidates,
        solverAttempts,
        acceptedByThreshold: true,
      });
    }
  }

  if (!best) {
    throw new Error(
      `Unable to find a solved reference-like random deal after ${maxAttempts.toLocaleString()} attempts: ${JSON.stringify(
        { rejectionCounts, solverAttempts, solvedCandidates },
      )}`,
    );
  }

  return formatResult(seed, maxAttempts, options.strategy ?? STRATEGY_NAME, best, {
    rejectionCounts,
    solvedCandidates,
    solverAttempts,
    acceptedByThreshold: false,
  });
}

function buildRandomState(random: Random): State {
  const cards = shuffle(random, expectedDealCards());
  const tableau: string[][] = [];
  let cursor = 0;
  for (const size of COLUMN_SIZES) {
    tableau.push(cards.slice(cursor, cursor + size));
    cursor += size;
  }
  return {
    ...INITIAL_STATE,
    minor: INITIAL_STATE.minor.slice(),
    tableau,
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

function cardDepth(state: State, card: string): number {
  for (const column of state.tableau) {
    const index = column.indexOf(card);
    if (index !== -1) return column.length - index - 1;
  }
  throw new Error(`Card is missing from tableau: ${card}`);
}

function countStackAdjacencies(state: State): { stackAdjacency: number; sameKindAdjacency: number } {
  let stackAdjacency = 0;
  let sameKindAdjacency = 0;

  for (const column of state.tableau) {
    for (let index = 0; index < column.length - 1; index++) {
      const below = column[index];
      const above = column[index + 1];
      if (canStackOn(above, below)) stackAdjacency++;

      const belowCard = decodeCard(below);
      const aboveCard = decodeCard(above);
      if (belowCard.kind === "major" && aboveCard.kind === "major") {
        sameKindAdjacency++;
      } else if (
        belowCard.kind === "minor" &&
        aboveCard.kind === "minor" &&
        belowCard.suitIndex === aboveCard.suitIndex
      ) {
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

function formatResult(
  seed: string,
  attempts: number,
  strategy: string,
  candidate: Candidate,
  search: {
    rejectionCounts: Record<RejectionReason, number>;
    solvedCandidates: number;
    solverAttempts: number;
    acceptedByThreshold: boolean;
  },
): GenerateDealResult {
  return {
    board: candidate.board,
    seed,
    attempts,
    strategy,
    metadata: {
      proof: STRATEGY_NAME,
      proofPath: candidate.path,
      candidateScore: candidate.score,
      candidateMetrics: summarizeMetrics(candidate.path.length, candidate.visited, candidate.metrics),
      initialProfile: summarizeProfile(candidate.profile),
      solveOptions: SOLVE_OPTIONS,
      search,
    },
  };
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
    avgEmptyColumns: round(metrics.avgEmptyColumns),
    initialBlockerScore: metrics.initialBlockerScore,
  };
}

function summarizeProfile(profile: InitialProfile): Record<string, number> {
  return {
    initialMoves: profile.initialMoves,
    topEligibleNextCards: profile.topEligibleNextCards,
    avgNextDepth: round(profile.avgNextDepth),
    maxNextDepth: profile.maxNextDepth,
    stackAdjacency: profile.stackAdjacency,
    sameKindAdjacency: profile.sameKindAdjacency,
    initialBlockers: profile.initialBlockers,
  };
}

function shuffle<T>(random: Random, values: T[]): T[] {
  const shuffled = values.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizedDistance(value: number, target: number): number {
  return Math.abs(value - target) / Math.max(1, Math.abs(target));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
