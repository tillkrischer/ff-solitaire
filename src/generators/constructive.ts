import {
  INITIAL_STATE,
  applyMove,
  autoMoveFoundations,
  canMoveToFoundation,
  canStackOn,
  cloneState,
  formatMove,
  hashState,
  isGoalState,
  replay,
  serializeBoard,
  type Move,
  type State,
} from "../game.ts";
import type { GenerateDealOptions, GenerateDealResult } from "../generator.ts";

type Random = () => number;
type SequenceConstraint =
  | { kind: "gate"; index: number }
  | { kind: "majorGate"; index: number }
  | { kind: "stackPair"; moverIndex: number; targetIndex: number }
  | { kind: "minorRun"; start: number; length: number }
  | { kind: "majorRun"; start: number; length: number };

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
const MULTI_GATE_MOVES: Move[] = [
  { fromType: "column", fromIndex: 0, toType: "column", toIndex: 5 },
  { fromType: "column", fromIndex: 6, toType: "column", toIndex: 5 },
  { fromType: "column", fromIndex: 7, toType: "column", toIndex: 5 },
];
const SCRIPTED_MOVES: Move[] = [
  { fromType: "column", fromIndex: 0, toType: "column", toIndex: 5 },
  { fromType: "column", fromIndex: 7, toType: "column", toIndex: 6 },
];
const PARK_LOCKED_MOVES: Move[] = [
  { fromType: "column", fromIndex: 0, toType: "column", toIndex: 5 },
  { fromType: "column", fromIndex: 6, toType: "park", toIndex: 0 },
];

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

export function generateMultiGateCascadeDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  return generateScriptedDeal(options, "multi-gate-cascade", buildMultiGateAttempt);
}

export function generateScriptedTableauDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  return generateScriptedDeal(options, "scripted-tableau-rearrangement", buildScriptedTableauAttempt);
}

export function generateParkLockedMinorDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  return generateScriptedDeal(options, "park-locked-minor-cascade", buildParkLockedAttempt);
}

function generateScriptedDeal(
  options: GenerateDealOptions,
  defaultStrategyName: string,
  build: (random: Random) => { state: State; proofPath: Move[]; metadata: Record<string, unknown> } | null,
): GenerateDealResult {
  const seed = String(options.seed ?? "default");
  const maxAttempts = options.maxAttempts ?? 10_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`maxAttempts must be a positive integer: ${maxAttempts}`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const random = createRandom(`${seed}:${attempt}`);
    const built = build(random);
    if (!built) continue;
    if (!hasInitialShape(built.state)) continue;
    if (hashState(autoMoveFoundations(built.state)) !== hashState(built.state)) continue;
    if (!proofPathSolves(built.state, built.proofPath)) continue;

    return {
      board: serializeBoard(built.state),
      seed,
      attempts: attempt,
      strategy: options.strategy ?? defaultStrategyName,
      metadata: {
        ...built.metadata,
        proofPath: built.proofPath.map(formatMove),
      },
    };
  }

  throw new Error(`Unable to generate a solvable deal after ${maxAttempts.toLocaleString()} attempts`);
}

function proofPathSolves(state: State, proofPath: Move[]): boolean {
  try {
    return isGoalState(replay(state, proofPath.map(formatMove)));
  } catch {
    return false;
  }
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

function buildMultiGateAttempt(random: Random): { state: State; proofPath: Move[]; metadata: Record<string, unknown> } | null {
  const sequence = buildConstrainedFoundationSequence(random, [
    { kind: "gate", index: 34 },
    { kind: "gate", index: 41 },
    { kind: "gate", index: 69 },
  ]);
  if (!sequence) return null;

  const tableau = emptyTableau();
  fillColumn(tableau, 0, sequence.slice(0, 6), sequence[34]);
  fillColumn(tableau, 1, sequence.slice(6, 13));
  fillColumn(tableau, 2, sequence.slice(13, 20));
  fillColumn(tableau, 3, sequence.slice(20, 27));
  fillColumn(tableau, 4, sequence.slice(27, 34));
  fillColumn(tableau, 6, sequence.slice(35, 41), sequence[41]);
  fillColumn(tableau, 7, sequence.slice(42, 48), sequence[69]);
  fillColumn(tableau, 8, sequence.slice(48, 55));
  fillColumn(tableau, 9, sequence.slice(55, 62));
  fillColumn(tableau, 10, sequence.slice(62, 69));

  return {
    state: { ...cloneState(INITIAL_STATE), tableau },
    proofPath: MULTI_GATE_MOVES,
    metadata: {
      proof: "multi-gate-cascade",
      gates: 3,
      cascadeSegments: [34, 6, 27],
      gateMoves: ["empty-column", "empty-column", "empty-column"],
    },
  };
}

function buildScriptedTableauAttempt(
  random: Random,
): { state: State; proofPath: Move[]; metadata: Record<string, unknown> } | null {
  const sequence = buildConstrainedFoundationSequence(random, [
    { kind: "gate", index: 34 },
    { kind: "stackPair", moverIndex: 62, targetIndex: 63 },
  ]);
  if (!sequence) return null;

  const tableau = emptyTableau();
  fillColumn(tableau, 0, sequence.slice(0, 6), sequence[34]);
  fillColumn(tableau, 1, sequence.slice(6, 13));
  fillColumn(tableau, 2, sequence.slice(13, 20));
  fillColumn(tableau, 3, sequence.slice(20, 27));
  fillColumn(tableau, 4, sequence.slice(27, 34));
  fillColumn(tableau, 6, sequence.slice(64, 70), sequence[63]);
  fillColumn(tableau, 7, sequence.slice(35, 41), sequence[62]);
  fillColumn(tableau, 8, sequence.slice(41, 48));
  fillColumn(tableau, 9, sequence.slice(48, 55));
  fillColumn(tableau, 10, sequence.slice(55, 62));

  return {
    state: { ...cloneState(INITIAL_STATE), tableau },
    proofPath: SCRIPTED_MOVES,
    metadata: {
      proof: "scripted-tableau-rearrangement",
      rearrangementMoves: 1,
      cascadeSegments: [34, 27, 8],
      chainType: "adjacent-stack",
    },
  };
}

function buildParkLockedAttempt(random: Random): { state: State; proofPath: Move[]; metadata: Record<string, unknown> } | null {
  const sequence = buildConstrainedFoundationSequence(random, [
    { kind: "gate", index: 34 },
    { kind: "majorRun", start: 35, length: 6 },
    { kind: "majorGate", index: 41 },
    { kind: "minorRun", start: 42, length: 6 },
  ]);
  if (!sequence) return null;

  const tableau = emptyTableau();
  fillColumn(tableau, 0, sequence.slice(0, 6), sequence[34]);
  fillColumn(tableau, 1, sequence.slice(6, 13));
  fillColumn(tableau, 2, sequence.slice(13, 20));
  fillColumn(tableau, 3, sequence.slice(20, 27));
  fillColumn(tableau, 4, sequence.slice(27, 34));
  fillColumn(tableau, 6, sequence.slice(35, 41), sequence[41]);
  fillColumn(tableau, 7, sequence.slice(42, 49));
  fillColumn(tableau, 8, sequence.slice(49, 56));
  fillColumn(tableau, 9, sequence.slice(56, 63));
  fillColumn(tableau, 10, sequence.slice(63, 70));

  return {
    state: { ...cloneState(INITIAL_STATE), tableau },
    proofPath: PARK_LOCKED_MOVES,
    metadata: {
      proof: "park-locked-minor-cascade",
      parkLockPhases: 1,
      parkLockedMajorRunLength: 6,
      blockedMinorRunLength: 6,
      parkedCardExit: "foundation-auto",
    },
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

function buildConstrainedFoundationSequence(random: Random, constraints: SequenceConstraint[]): string[] | null {
  const state = cloneState(INITIAL_STATE);
  const remaining = new Set(allDealCards());
  const sequence: string[] = [];
  const byIndex = new Map<number, SequenceConstraint>();
  for (const constraint of constraints) {
    const index =
      constraint.kind === "gate" || constraint.kind === "majorGate"
        ? constraint.index
        : constraint.kind === "stackPair"
          ? constraint.moverIndex
          : constraint.start;
    byIndex.set(index, constraint);
  }

  for (let index = 0; index < 70; index++) {
    const constraint = byIndex.get(index);
    if (constraint?.kind === "gate") {
      const eligible = [...remaining].filter((card) => canMoveToFoundation(state, card, false) && !initiallyAutoMoves(card));
      if (eligible.length === 0) return null;
      const card = choose(random, eligible);
      remaining.delete(card);
      sequence.push(card);
      advanceFoundation(state, card);
      continue;
    }

    if (constraint?.kind === "majorGate") {
      const eligible = [...remaining].filter(
        (card) => card[0] === "M" && canMoveToFoundation(state, card, false) && !initiallyAutoMoves(card),
      );
      if (eligible.length === 0) return null;
      const card = choose(random, eligible);
      remaining.delete(card);
      sequence.push(card);
      advanceFoundation(state, card);
      continue;
    }

    if (constraint?.kind === "stackPair") {
      const pair = chooseStackPair(random, state, remaining);
      if (!pair) return null;
      for (const card of pair) {
        remaining.delete(card);
        sequence.push(card);
        advanceFoundation(state, card);
      }
      index++;
      continue;
    }

    if (constraint?.kind === "minorRun") {
      for (let offset = 0; offset < constraint.length; offset++) {
        const eligible = [...remaining].filter((card) => card[0] !== "M" && canMoveToFoundation(state, card, false));
        if (eligible.length === 0) return null;
        const card = choose(random, eligible);
        remaining.delete(card);
        sequence.push(card);
        advanceFoundation(state, card);
      }
      index += constraint.length - 1;
      continue;
    }

    if (constraint?.kind === "majorRun") {
      for (let offset = 0; offset < constraint.length; offset++) {
        const eligible = [...remaining].filter((card) => card[0] === "M" && canMoveToFoundation(state, card, false));
        if (eligible.length === 0) return null;
        const card = choose(random, eligible);
        remaining.delete(card);
        sequence.push(card);
        advanceFoundation(state, card);
      }
      index += constraint.length - 1;
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

function chooseStackPair(random: Random, state: State, remaining: Set<string>): [string, string] | null {
  const pairs: [string, string][] = [];
  for (const mover of remaining) {
    if (initiallyAutoMoves(mover) || !canMoveToFoundation(state, mover, false)) continue;
    const afterMover = cloneState(state);
    advanceFoundation(afterMover, mover);
    for (const target of remaining) {
      if (target === mover || initiallyAutoMoves(target)) continue;
      if (!canMoveToFoundation(afterMover, target, false)) continue;
      if (canStackOn(mover, target)) pairs.push([mover, target]);
    }
  }
  return pairs.length === 0 ? null : choose(random, pairs);
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

function emptyTableau(): string[][] {
  return [[], [], [], [], [], [], [], [], [], [], []];
}

function fillColumn(tableau: string[][], columnIndex: number, foundationCards: string[], topCard?: string): void {
  tableau[columnIndex] = foundationCards.slice().reverse();
  if (topCard) tableau[columnIndex].push(topCard);
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
