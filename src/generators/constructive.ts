import {
  INITIAL_STATE,
  applyMove,
  autoMoveFoundations,
  canMoveToFoundation,
  cloneState,
  formatMove,
  hashState,
  isGoalState,
  serializeBoard,
  type State,
} from "../game.ts";
import type { GenerateDealOptions, GenerateDealResult } from "../generator.ts";

type Random = () => number;

const STRATEGY_NAME = "constructive";
const FIRST_MOVE = {
  fromType: "column" as const,
  fromIndex: 0,
  toType: "column" as const,
  toIndex: 5,
};
const COVER_INDEX = 34;
const COLUMN_SIZES = [7, 7, 7, 7, 7, 0, 7, 7, 7, 7, 7];
const HIDDEN_COLUMN_SIZES_AFTER_FIRST_MOVE = [6, 7, 7, 7, 7, 0, 7, 7, 7, 7, 7];

export function generateConstructiveDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  const seed = String(options.seed ?? "default");
  const maxAttempts = options.maxAttempts ?? 10_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`maxAttempts must be a positive integer: ${maxAttempts}`);
  }

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
  const sequence = buildFoundationSequence(random, cover);
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

function buildFoundationSequence(random: Random, cover: string): string[] | null {
  const state = cloneState(INITIAL_STATE);
  const remaining = new Set(allDealCards());
  remaining.delete(cover);
  const sequence: string[] = [];

  for (let index = 0; index < 70; index++) {
    if (index === COVER_INDEX) {
      if (!canMoveToFoundation(state, cover, false)) return null;
      sequence.push(cover);
      advanceFoundation(state, cover);
      continue;
    }

    const eligible = [...remaining].filter((card) => canMoveToFoundation(state, card, false));
    if (eligible.length === 0) return null;

    const card = choose(random, eligible);
    remaining.delete(card);
    sequence.push(card);
    advanceFoundation(state, card);
  }

  return remaining.size === 0 ? sequence : null;
}

function advanceFoundation(state: State, card: string): void {
  const singleCardTableau = [[card], [], [], [], [], [], [], [], [], [], []];
  const next = autoMoveFoundations({ ...cloneState(state), tableau: singleCardTableau });
  state.majorLow = next.majorLow;
  state.majorHigh = next.majorHigh;
  state.minor = next.minor;
}

function hasInitialShape(state: State): boolean {
  return (
    state.majorLow === -1 &&
    state.majorHigh === 22 &&
    state.park === null &&
    state.minor.every((rank) => rank === 1) &&
    state.tableau.length === COLUMN_SIZES.length &&
    state.tableau.every((column, index) => column.length === COLUMN_SIZES[index])
  );
}

function allDealCards(): string[] {
  const cards: string[] = [];
  for (let rank = 0; rank <= 21; rank++) {
    cards.push(`M${rank}`);
  }
  for (const suit of ["C", "S", "A", "T"]) {
    for (let rank = 2; rank <= 13; rank++) {
      cards.push(`${suit}${rank}`);
    }
  }
  return cards;
}

function allCoverCandidates(): string[] {
  return allDealCards().filter((card) => !initiallyAutoMoves(card));
}

function initiallyAutoMoves(card: string): boolean {
  return card === "M0" || card === "M21" || (card[0] !== "M" && card.slice(1) === "2");
}

function choose<T>(random: Random, values: T[]): T {
  if (values.length === 0) throw new Error("Cannot choose from an empty list");
  return values[Math.floor(random() * values.length)];
}

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
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
