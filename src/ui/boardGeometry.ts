import type { BoardGeometry, DragState, VisualRect } from "./types.ts";

export const BOARD_WIDTH = 2868;
export const BOARD_HEIGHT = 1790;
export const MAJOR_FOUNDATION_BACK_OFFSET = 36;
export const MAJOR_FOUNDATION_MAX_BACKS = 7;

export function makeGeometry(): BoardGeometry {
  const card = { width: 198, height: 340 };
  const columnGap = 44;
  const startX = 126;
  const tableauY = 555;
  const columns = Array.from({ length: 11 }, (_, index) => ({
    x: startX + index * (card.width + columnGap),
    y: tableauY,
    width: card.width,
    height: 1000,
  }));
  const minorFoundations = [1900, 2128, 2356, 2584].map((x) => ({
    x,
    y: 110,
    width: card.width,
    height: card.height,
  }));
  return {
    board: { x: 0, y: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT },
    topBand: { x: 0, y: 0, width: BOARD_WIDTH, height: 520 },
    tableau: { x: 0, y: tableauY, width: BOARD_WIDTH, height: 1090 },
    card,
    stackOffset: 48,
    columns,
    minorFoundations,
    park: { x: 2117, y: 180, width: card.height, height: card.width, rotated: true },
    majorLow: { x: 130, y: 110, width: card.width, height: card.height },
    majorHigh: { x: 820, y: 110, width: card.width, height: card.height },
  };
}

export function getColumnCardRect(geometry: BoardGeometry, columnIndex: number, cardIndex: number): VisualRect {
  const column = geometry.columns[columnIndex];
  return {
    x: column.x,
    y: column.y + cardIndex * geometry.stackOffset,
    width: geometry.card.width,
    height: geometry.card.height,
  };
}

export function getEmptyColumnDropRect(geometry: BoardGeometry, columnIndex: number): VisualRect {
  const column = geometry.columns[columnIndex];
  return {
    x: column.x,
    y: column.y,
    width: geometry.card.width,
    height: geometry.card.height,
  };
}

export function getDragCardRect(geometry: BoardGeometry, drag: DragState): VisualRect {
  if (drag.horizontal) {
    return {
      x: drag.pointer.x - drag.pointerOffset.x,
      y: drag.pointer.y - drag.pointerOffset.y,
      width: geometry.card.height,
      height: geometry.card.width,
      rotated: true,
    };
  }
  return {
    x: drag.pointer.x - drag.pointerOffset.x,
    y: drag.pointer.y - drag.pointerOffset.y,
    width: geometry.card.width,
    height: geometry.card.height,
  };
}

export function getMajorFoundationTopX(rect: VisualRect, direction: "low" | "high", count: number): number {
  const visibleBacks = majorFoundationVisibleBacks(count);
  return direction === "low"
    ? rect.x + visibleBacks * MAJOR_FOUNDATION_BACK_OFFSET
    : rect.x - visibleBacks * MAJOR_FOUNDATION_BACK_OFFSET;
}

export function majorFoundationVisibleBacks(count: number): number {
  return Math.min(Math.max(0, count - 1), MAJOR_FOUNDATION_MAX_BACKS);
}
