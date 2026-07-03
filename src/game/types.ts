export type CardId = string;

export const suits = ["cups", "swords", "stars", "thorns"] as const;

export type Suit = (typeof suits)[number];

export type MinorRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export type MajorRank =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21;

export type MinorCard = {
  id: CardId;
  kind: "minor";
  suit: Suit;
  rank: MinorRank;
};

export type MajorCard = {
  id: CardId;
  kind: "major";
  rank: MajorRank;
  name: string;
};

export type Card = MinorCard | MajorCard;

export type FoundationState = {
  minor: Record<Suit, CardId[]>;
  majorLow: CardId[];
  majorHigh: CardId[];
};

export type TableauColumn = CardId[];

export type MoveMode = "single-card" | "entire-stack";

export type GameStatus = "playing" | "won";

export type GameStateSnapshot = Omit<GameState, "history">;

export type GameState = {
  cardsById: Record<CardId, Card>;
  tableau: TableauColumn[];
  foundations: FoundationState;
  parkedCard: CardId | null;
  moveMode: MoveMode;
  history: GameStateSnapshot[];
  seed: string;
  status: GameStatus;
};

export type TableauLocation = {
  type: "tableau";
  column: number;
  index?: number;
};

export type Location =
  | TableauLocation
  | { type: "minor-foundation"; suit: Suit }
  | { type: "major-low" }
  | { type: "major-high" }
  | { type: "park" };

export type MoveCommand = {
  from: Location;
  to: Location;
};

export type SolverResult =
  | {
      solvable: true;
      moves: MoveCommand[];
      visitedStates: number;
    }
  | {
      solvable: false;
      visitedStates: number;
      reason: "exhausted" | "limit";
    };
