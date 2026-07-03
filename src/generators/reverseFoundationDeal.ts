import { INITIAL_STATE, formatMove, serializeBoard, type Move, type State } from "../game.ts";
import { validateInitialDeal } from "../dealValidation.ts";
import type { GenerateDealOptions, GenerateDealResult, GenerationStrategy } from "../generator.ts";
import { assertValidMaxAttempts, choose, createRandom, type Random } from "./shared.ts";

const STRATEGY_NAME = "reverse-foundation-deal";
const DEFAULT_MAX_ATTEMPTS = 10_000;
const MAJOR_SPLIT = { low: 10, high: 11 };
const COVER_INDEX = 34;
const HIDDEN_COLUMN_SIZES_AFTER_FIRST_MOVE = [6, 7, 7, 7, 7, 0, 7, 7, 7, 7, 7];
const OPENING_MOVE: Move = {
  fromType: "column",
  fromIndex: 0,
  toType: "column",
  toIndex: 5,
};
const SUITS = ["C", "S", "A", "T"] as const;

export const reverseFoundationDealStrategy: GenerationStrategy = {
  name: STRATEGY_NAME,
  generate: generateReverseFoundationDeal,
};

export function generateReverseFoundationDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  const seed = String(options.seed ?? "default");
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  assertValidMaxAttempts(maxAttempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const random = createRandom(`${seed}:${attempt}`);
    const foundationOrder = buildFoundationOrder(random);
    const state = buildInitialState(foundationOrder);
    const validation = validateInitialDeal(serializeBoard(state));
    if (!validation.ok) continue;

    return {
      board: serializeBoard(state),
      seed,
      attempts: attempt,
      strategy: options.strategy ?? STRATEGY_NAME,
      metadata: {
        proof: "reverse-foundation-order",
        proofPath: [formatMove(OPENING_MOVE)],
        foundationOrder,
        majorSplit: MAJOR_SPLIT,
        coverCard: foundationOrder[COVER_INDEX],
      },
    };
  }

  throw new Error(`Unable to generate a reverse foundation deal after ${maxAttempts.toLocaleString()} attempts`);
}

function buildFoundationOrder(random: Random): string[] {
  const foundation = {
    minor: [13, 13, 13, 13],
    majorLow: MAJOR_SPLIT.low,
    majorHigh: MAJOR_SPLIT.high,
  };
  const removalOrder: string[] = [];

  while (!isInitialFoundation(foundation)) {
    const candidates = exposedFoundationCards(foundation);
    const card = choose(random, candidates);
    removalOrder.push(card);
    removeFoundationCard(foundation, card);
  }

  return removalOrder.reverse();
}

function buildInitialState(foundationOrder: string[]): State {
  const tableau: string[][] = [];
  const cover = foundationOrder[COVER_INDEX];
  const hiddenOrder = foundationOrder.filter((_, index) => index !== COVER_INDEX);
  let cursor = 0;

  for (let columnIndex = 0; columnIndex < HIDDEN_COLUMN_SIZES_AFTER_FIRST_MOVE.length; columnIndex++) {
    const size = HIDDEN_COLUMN_SIZES_AFTER_FIRST_MOVE[columnIndex];
    const chunk = hiddenOrder.slice(cursor, cursor + size);
    if (chunk.length !== size) {
      throw new Error(`Foundation order did not fill tableau shape at column ${tableau.length}`);
    }
    tableau.push(chunk.reverse());
    cursor += size;
  }

  if (hiddenOrder[cursor] !== undefined) {
    throw new Error("Foundation order contains extra cards after filling tableau");
  }
  tableau[0].push(cover);

  return {
    ...INITIAL_STATE,
    minor: INITIAL_STATE.minor.slice(),
    tableau,
  };
}

function exposedFoundationCards(foundation: {
  minor: number[];
  majorLow: number;
  majorHigh: number;
}): string[] {
  const cards: string[] = [];
  for (let suitIndex = 0; suitIndex < foundation.minor.length; suitIndex++) {
    const rank = foundation.minor[suitIndex];
    if (rank > 1) cards.push(`${SUITS[suitIndex]}${rank}`);
  }
  if (foundation.majorLow > -1) cards.push(`M${foundation.majorLow}`);
  if (foundation.majorHigh < 22) cards.push(`M${foundation.majorHigh}`);
  return cards;
}

function removeFoundationCard(
  foundation: {
    minor: number[];
    majorLow: number;
    majorHigh: number;
  },
  card: string,
): void {
  if (card[0] === "M") {
    const rank = Number(card.slice(1));
    if (rank === foundation.majorLow) {
      foundation.majorLow--;
      return;
    }
    if (rank === foundation.majorHigh) {
      foundation.majorHigh++;
      return;
    }
    throw new Error(`Major card is not exposed on a foundation: ${card}`);
  }

  const suitIndex = SUITS.indexOf(card[0] as (typeof SUITS)[number]);
  const rank = Number(card.slice(1));
  if (suitIndex === -1 || rank !== foundation.minor[suitIndex]) {
    throw new Error(`Minor card is not exposed on a foundation: ${card}`);
  }
  foundation.minor[suitIndex]--;
}

function isInitialFoundation(foundation: { minor: number[]; majorLow: number; majorHigh: number }): boolean {
  return foundation.majorLow === -1 && foundation.majorHigh === 22 && foundation.minor.every((rank) => rank === 1);
}
