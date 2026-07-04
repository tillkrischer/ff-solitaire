import { parseBoard, serializeBoard, type State } from "../game.ts";
import type { GenerateDealOptions, GenerateDealResult, GenerationStrategy } from "../generator.ts";
import { REFERENCE_DEALS } from "../data/referenceDeals.ts";
import { createRandom, type Random } from "./shared.ts";

const STRATEGY_NAME = "reference-pool";
const MINOR_SUITS = ["C", "S", "A", "T"] as const;
const OCCUPIED_COLUMNS = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10] as const;

export const referencePoolStrategy: GenerationStrategy = {
  name: STRATEGY_NAME,
  generate: generateReferencePoolDeal,
};

export function generateReferencePoolDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  const seed = options.seed === undefined ? `${STRATEGY_NAME}:${Date.now()}:${Math.random()}` : String(options.seed);
  const random = createRandom(seed);
  const sourceIndex = Math.floor(random() * REFERENCE_DEALS.length);
  const state = parseBoard(REFERENCE_DEALS[sourceIndex], { autoMove: false });
  const suitPermutation = shuffled(random, [...MINOR_SUITS]);
  const columnPermutation = shuffled(random, [...OCCUPIED_COLUMNS]);
  const transformed = shuffleOccupiedColumns(remapMinorSuits(state, suitPermutation), columnPermutation);

  return {
    board: serializeBoard(transformed),
    seed,
    attempts: 1,
    strategy: options.strategy ?? STRATEGY_NAME,
    metadata: {
      source: "reference-generated",
      sourceRank: sourceIndex + 1,
      suitPermutation,
      columnPermutation,
    },
  };
}

function remapMinorSuits(state: State, suitPermutation: readonly string[]): State {
  const suitBySource = new Map(MINOR_SUITS.map((suit, index) => [suit, suitPermutation[index]]));
  return {
    ...state,
    tableau: state.tableau.map((column) =>
      column.map((card) => {
        const mappedSuit = suitBySource.get(card[0] as (typeof MINOR_SUITS)[number]);
        return mappedSuit ? `${mappedSuit}${card.slice(1)}` : card;
      }),
    ),
  };
}

function shuffleOccupiedColumns(state: State, columnPermutation: readonly number[]): State {
  const tableau = state.tableau.map((column) => column.slice());
  for (let index = 0; index < OCCUPIED_COLUMNS.length; index++) {
    tableau[OCCUPIED_COLUMNS[index]] = state.tableau[columnPermutation[index]].slice();
  }
  return { ...state, tableau };
}

function shuffled<T>(random: Random, values: T[]): T[] {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}
