import {
  INITIAL_STATE,
  applyMove,
  autoMoveFoundations,
  cloneState,
  formatMove,
  hashState,
  isGoalState,
  serializeBoard,
  type State,
} from "../game.ts";
import type { GenerateDealOptions, GenerateDealResult, GenerationStrategy } from "../generator.ts";
import {
  allCoverCandidates,
  assertValidMaxAttempts,
  buildFoundationSequence,
  choose,
  createRandom,
  hasInitialShape,
  type Random,
} from "./shared.ts";

const STRATEGY_NAME = "one-move-constructive";
const FIRST_MOVE = {
  fromType: "column" as const,
  fromIndex: 0,
  toType: "column" as const,
  toIndex: 5,
};
const COVER_INDEX = 34;
const HIDDEN_COLUMN_SIZES_AFTER_FIRST_MOVE = [6, 7, 7, 7, 7, 0, 7, 7, 7, 7, 7];

export const oneMoveConstructiveStrategy: GenerationStrategy = {
  name: STRATEGY_NAME,
  generate: generateConstructiveDeal,
};

export function generateConstructiveDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  const seed = String(options.seed ?? "default");
  const maxAttempts = options.maxAttempts ?? 10_000;
  assertValidMaxAttempts(maxAttempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const random = createRandom(`${seed}:${attempt}`);
    const board = buildAttempt(random);
    if (!board) continue;

    const initial = board;
    if (!hasInitialShape(initial)) continue;
    if (hashState(autoMoveFoundations(initial)) !== hashState(initial)) continue;
    if (!isGoalState(applyMove(initial, FIRST_MOVE))) continue;

    return {
      board: serializeBoard(initial),
      seed,
      attempts: attempt,
      strategy: options.strategy ?? STRATEGY_NAME,
      metadata: {
        proof: "one-move",
        proofPath: [formatMove(FIRST_MOVE)],
      },
    };
  }

  throw new Error(`Unable to generate a solvable deal after ${maxAttempts.toLocaleString()} attempts`);
}

function buildAttempt(random: Random): State | null {
  const cover = choose(random, allCoverCandidates());
  const sequence = buildFoundationSequence(random, cover, COVER_INDEX);
  if (!sequence) return null;
  const hiddenSequence = sequence.filter((card) => card !== cover);

  const tableau: string[][] = [];
  let cursor = 0;
  for (let columnIndex = 0; columnIndex < HIDDEN_COLUMN_SIZES_AFTER_FIRST_MOVE.length; columnIndex++) {
    const size = HIDDEN_COLUMN_SIZES_AFTER_FIRST_MOVE[columnIndex];
    if (columnIndex === 5) {
      tableau.push([]);
      continue;
    }

    const chunk = hiddenSequence.slice(cursor, cursor + size);
    if (chunk.length !== size) return null;
    tableau.push(chunk.reverse());
    cursor += size;
  }

  if (hiddenSequence[cursor] !== undefined) return null;
  tableau[0].push(cover);

  return {
    ...cloneState(INITIAL_STATE),
    tableau,
  };
}
