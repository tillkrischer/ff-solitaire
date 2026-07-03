import {
  INITIAL_STATE,
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

export type Random = () => number;
export type SequenceConstraint =
  | { kind: "gate"; index: number }
  | { kind: "majorGate"; index: number }
  | { kind: "stackPair"; moverIndex: number; targetIndex: number }
  | { kind: "minorRun"; start: number; length: number }
  | { kind: "majorRun"; start: number; length: number };

export type ScriptedBuildResult = { state: State; proofPath: Move[]; metadata: Record<string, unknown> };

export const COLUMN_SIZES = [7, 7, 7, 7, 7, 0, 7, 7, 7, 7, 7];

export function generateScriptedDeal(
  options: GenerateDealOptions,
  defaultStrategyName: string,
  build: (random: Random) => ScriptedBuildResult | null,
): GenerateDealResult {
  const seed = String(options.seed ?? "default");
  const maxAttempts = options.maxAttempts ?? 10_000;
  assertValidMaxAttempts(maxAttempts);

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

export function assertValidMaxAttempts(maxAttempts: number): void {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`maxAttempts must be a positive integer: ${maxAttempts}`);
  }
}

export function hasInitialShape(state: State): boolean {
  return (
    state.majorLow === -1 &&
    state.majorHigh === 22 &&
    state.park === null &&
    state.minor.every((rank) => rank === 1) &&
    state.tableau.length === COLUMN_SIZES.length &&
    state.tableau.every((column, index) => column.length === COLUMN_SIZES[index])
  );
}

export function buildConstrainedFoundationSequence(random: Random, constraints: SequenceConstraint[]): string[] | null {
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

export function buildFoundationSequence(random: Random, cover: string, coverIndex: number): string[] | null {
  const state = cloneState(INITIAL_STATE);
  const remaining = new Set(allDealCards());
  remaining.delete(cover);
  const sequence: string[] = [];

  for (let index = 0; index < 70; index++) {
    if (index === coverIndex) {
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

export function allCoverCandidates(): string[] {
  return allDealCards().filter((card) => !initiallyAutoMoves(card));
}

export function emptyTableau(): string[][] {
  return [[], [], [], [], [], [], [], [], [], [], []];
}

export function fillColumn(tableau: string[][], columnIndex: number, foundationCards: string[], topCard?: string): void {
  tableau[columnIndex] = foundationCards.slice().reverse();
  if (topCard) tableau[columnIndex].push(topCard);
}

export function choose<T>(random: Random, values: T[]): T {
  if (values.length === 0) throw new Error("Cannot choose from an empty list");
  return values[Math.floor(random() * values.length)];
}

export function createRandom(seed: string): Random {
  let state = hashSeed(seed);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function proofPathSolves(state: State, proofPath: Move[]): boolean {
  try {
    return isGoalState(replay(state, proofPath.map(formatMove)));
  } catch {
    return false;
  }
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

function initiallyAutoMoves(card: string): boolean {
  return card === "M0" || card === "M21" || (card[0] !== "M" && card.slice(1) === "2");
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

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
