import type { Card, CardId, FoundationState, GameState, MajorRank, MinorRank, MoveMode, Suit } from "./types";
import { suits } from "./types";

const majorNames = [
  "The Fool",
  "The Magician",
  "The High Priestess",
  "The Empress",
  "The Emperor",
  "The Hierophant",
  "The Lovers",
  "The Chariot",
  "Strength",
  "The Hermit",
  "Wheel of Fortune",
  "Justice",
  "The Hanged Man",
  "Death",
  "Temperance",
  "The Devil",
  "The Tower",
  "The Stars",
  "The Moon",
  "The Sun",
  "Judgement",
  "The World"
] as const;

export function minorCardId(suit: Suit, rank: MinorRank): CardId {
  return `minor:${suit}:${rank}`;
}

export function majorCardId(rank: MajorRank): CardId {
  return `major:${rank}`;
}

export function createDeck(): Card[] {
  const minors = suits.flatMap((suit) =>
    Array.from({ length: 13 }, (_, index) => {
      const rank = (index + 1) as MinorRank;
      return {
        id: minorCardId(suit, rank),
        kind: "minor" as const,
        suit,
        rank
      };
    })
  );

  const majors = majorNames.map((name, rank) => ({
    id: majorCardId(rank as MajorRank),
    kind: "major" as const,
    rank: rank as MajorRank,
    name
  }));

  return [...minors, ...majors];
}

export function indexCards(cards: Card[]): Record<CardId, Card> {
  return Object.fromEntries(cards.map((card) => [card.id, card]));
}

export function createFoundations(): FoundationState {
  return {
    minor: {
      cups: [minorCardId("cups", 1)],
      swords: [minorCardId("swords", 1)],
      stars: [minorCardId("stars", 1)],
      thorns: [minorCardId("thorns", 1)]
    },
    majorLow: [],
    majorHigh: []
  };
}

export function createNewGame(options: { seed: string; moveMode?: MoveMode }): GameState {
  const deck = createDeck();
  const foundations = createFoundations();
  const foundationCardIds = new Set(Object.values(foundations.minor).flat());
  const tableauCards = shuffle(
    deck.filter((card) => !foundationCardIds.has(card.id)).map((card) => card.id),
    options.seed
  );

  const filledColumns = Array.from({ length: 10 }, (_, columnIndex) =>
    tableauCards.slice(columnIndex * 7, columnIndex * 7 + 7)
  );

  const tableau = [
    ...filledColumns.slice(0, 5),
    [],
    ...filledColumns.slice(5)
  ];

  return {
    cardsById: indexCards(deck),
    tableau,
    foundations,
    parkedCard: null,
    moveMode: options.moveMode ?? "entire-stack",
    history: [],
    seed: options.seed,
    status: "playing"
  };
}

export function shuffle<T>(values: T[], seed: string): T[] {
  const result = [...values];
  const random = mulberry32(hashSeed(seed));

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
