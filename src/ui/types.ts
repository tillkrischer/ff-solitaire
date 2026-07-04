import type { Move } from "../game.ts";

export type GameMode = "single-card" | "entire-stack";

export type SourceLocation = { type: "column"; index: number } | { type: "park"; index: 0 };
export type DropLocation = { type: "column"; index: number } | { type: "park"; index: 0 };
export type FoundationTarget = "major-low" | "major-high" | `minor-${number}`;

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisualRect = Rect & {
  rotated?: boolean;
};

export type DragState = {
  source: SourceLocation;
  card: string;
  pointerOffset: { x: number; y: number };
  pointer: { x: number; y: number };
  horizontal: boolean;
  validMoves: Move[];
};

export type FlyingCard = {
  card: string;
  from: VisualRect;
  to: VisualRect;
  hiddenSource: SourceLocation;
  progress: number;
};

export type FlyingStack = {
  cards: string[];
  from: VisualRect[];
  to: VisualRect[];
  hiddenSource: { columnIndex: number; startIndex: number; count: number };
  progress: number;
};

export type BoardGeometry = {
  board: Rect;
  topBand: Rect;
  tableau: Rect;
  card: { width: number; height: number };
  stackOffset: number;
  columns: Rect[];
  minorFoundations: VisualRect[];
  park: VisualRect;
  majorLow: VisualRect;
  majorHigh: VisualRect;
};
