import { decodeCard, type State } from "../game.ts";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MAJOR_FOUNDATION_BACK_OFFSET,
  getColumnCardRect,
  getDragCardRect,
  getMajorFoundationTopX,
  majorFoundationVisibleBacks,
} from "./boardGeometry.ts";
import type { BoardGeometry, DragState, DropLocation, FlyingCard, FlyingStack, Rect, VisualRect } from "./types.ts";
import { dropKey, sourceKey } from "./utils.ts";

const SUITS = [
  { name: "Cups", code: "C", symbol: "◆", color: "#a83e2f" },
  { name: "Swords", code: "S", symbol: "†", color: "#24798c" },
  { name: "Stars", code: "A", symbol: "✦", color: "#9a6d22" },
  { name: "Thorns", code: "T", symbol: "♣", color: "#3f8138" },
] as const;
const MAJOR_NAMES = [
  "The Fool",
  "The Magician",
  "The Priestess",
  "The Empress",
  "The Emperor",
  "The Hierophant",
  "The Lovers",
  "The Chariot",
  "Strength",
  "The Hermit",
  "Fortune",
  "Justice",
  "The Hanged One",
  "Death",
  "Temperance",
  "The Devil",
  "The Tower",
  "The Star",
  "The Moon",
  "The Sun",
  "Judgement",
  "The World",
];

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  geometry: BoardGeometry,
  state: State,
  drag: DragState | null,
  flyingCard: FlyingCard | null,
  flyingStack: FlyingStack | null,
): void {
  drawBackground(ctx, geometry);
  const hiddenKey = drag ? sourceKey(drag.source) : flyingCard ? sourceKey(flyingCard.hiddenSource) : null;
  const validDrops = new Set(drag?.validMoves.map((move) => dropKey({ type: move.toType, index: move.toIndex } as DropLocation)) ?? []);
  drawMajorFoundationStack(ctx, geometry.majorLow, "low", state.majorLow, geometry.card);
  drawMajorFoundationStack(ctx, geometry.majorHigh, "high", state.majorHigh, geometry.card);
  drawMinorFoundations(ctx, geometry, state);
  drawPark(ctx, geometry, state, hiddenKey, validDrops);
  drawTableau(ctx, geometry, state, hiddenKey, flyingStack?.hiddenSource ?? null, validDrops);

  if (flyingStack) drawFlyingStack(ctx, flyingStack, geometry.card);
  if (flyingCard) drawFlyingCard(ctx, flyingCard, geometry.card);
  if (drag) drawDragCard(ctx, geometry, drag);
}

function drawBackground(ctx: CanvasRenderingContext2D, geometry: BoardGeometry): void {
  const separatorY = geometry.topBand.y + geometry.topBand.height;
  ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.fillStyle = "#20110d";
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.fillStyle = "#6f211a";
  ctx.fillRect(0, geometry.topBand.y, BOARD_WIDTH, geometry.topBand.height);
  ctx.fillStyle = "#2a1a12";
  ctx.fillRect(0, separatorY, BOARD_WIDTH, BOARD_HEIGHT - separatorY);
  ctx.fillStyle = "rgba(195,110,52,0.55)";
  for (let x = 80; x < BOARD_WIDTH; x += 70) {
    for (let y = separatorY + 28; y < BOARD_HEIGHT - 120; y += 70) {
      ctx.fillText("✦", x, y);
    }
  }
  ctx.strokeStyle = "#a8632c";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, separatorY);
  ctx.lineTo(BOARD_WIDTH, separatorY);
  ctx.stroke();
  ctx.fillStyle = "#bd7030";
  for (let x = 115; x < BOARD_WIDTH - 80; x += 72) drawTriangle(ctx, x, geometry.topBand.y + 28, 26);
}

function drawMajorFoundationStack(
  ctx: CanvasRenderingContext2D,
  rect: VisualRect,
  direction: "low" | "high",
  rank: number,
  cardSize: { width: number; height: number },
): void {
  const isEmpty = direction === "low" ? rank < 0 : rank > 21;
  if (isEmpty) {
    drawEmptySlot(ctx, rect);
    return;
  }
  const count = direction === "low" ? rank + 1 : 22 - rank;
  const visibleBacks = majorFoundationVisibleBacks(count);
  for (let i = 0; i < visibleBacks; i++) {
    const x = direction === "low" ? rect.x + i * MAJOR_FOUNDATION_BACK_OFFSET : rect.x - i * MAJOR_FOUNDATION_BACK_OFFSET;
    const visibleRank = direction === "low" ? rank - visibleBacks + i : rank + visibleBacks - i;
    drawCard(ctx, `M${visibleRank}`, { ...rect, x, width: cardSize.width, height: cardSize.height });
  }
  const topX = getMajorFoundationTopX(rect, direction, count);
  drawCard(ctx, `M${rank}`, { ...rect, x: topX });
}

function drawMinorFoundations(ctx: CanvasRenderingContext2D, geometry: BoardGeometry, state: State): void {
  geometry.minorFoundations.forEach((rect, index) => {
    drawCard(ctx, `${SUITS[index].code}${state.minor[index]}`, rect);
  });
}

function drawPark(ctx: CanvasRenderingContext2D, geometry: BoardGeometry, state: State, hiddenKey: string | null, validDrops: Set<string>): void {
  const isValidDrop = validDrops.has(dropKey({ type: "park", index: 0 }));
  if (isValidDrop) {
    drawHighlight(ctx, geometry.park);
    if (!state.park) drawEmptySlot(ctx, geometry.park);
  }
  if (state.park && hiddenKey !== sourceKey({ type: "park", index: 0 })) drawCard(ctx, state.park, geometry.park);
}

function drawTableau(
  ctx: CanvasRenderingContext2D,
  geometry: BoardGeometry,
  state: State,
  hiddenKey: string | null,
  hiddenStack: FlyingStack["hiddenSource"] | null,
  validDrops: Set<string>,
): void {
  state.tableau.forEach((column, index) => {
    const columnRect = geometry.columns[index];
    const drop = dropKey({ type: "column", index });
    const isValidDrop = validDrops.has(drop);
    drawEmptySlot(ctx, { ...columnRect, height: geometry.card.height }, { fill: "#2a1a12" });
    if (column.length === 0) {
      if (isValidDrop) drawHighlight(ctx, { ...columnRect, height: geometry.card.height });
      return;
    }
    column.forEach((card, cardIndex) => {
      const topCardHidden = cardIndex === column.length - 1 && hiddenKey === sourceKey({ type: "column", index });
      const stackCardHidden =
        hiddenStack &&
        hiddenStack.columnIndex === index &&
        cardIndex >= hiddenStack.startIndex &&
        cardIndex < hiddenStack.startIndex + hiddenStack.count;
      if (!topCardHidden && !stackCardHidden) drawCard(ctx, card, getColumnCardRect(geometry, index, cardIndex));
    });
    if (isValidDrop) drawHighlight(ctx, getColumnCardRect(geometry, index, column.length - 1));
  });
}

function drawDragCard(ctx: CanvasRenderingContext2D, geometry: BoardGeometry, drag: DragState): void {
  drawCard(ctx, drag.card, getDragCardRect(geometry, drag), true);
}

function drawFlyingCard(ctx: CanvasRenderingContext2D, flying: FlyingCard, cardSize: { width: number; height: number }): void {
  const x = lerp(flying.from.x, flying.to.x, flying.progress);
  const y = lerp(flying.from.y, flying.to.y, flying.progress);
  const rotated = flying.to.rotated && flying.progress > 0.5;
  drawCard(ctx, flying.card, {
    x,
    y,
    width: rotated ? cardSize.height : cardSize.width,
    height: rotated ? cardSize.width : cardSize.height,
    rotated,
  }, true);
}

function drawFlyingStack(ctx: CanvasRenderingContext2D, flying: FlyingStack, cardSize: { width: number; height: number }): void {
  flying.cards.forEach((card, index) => {
    const from = flying.from[index];
    const to = flying.to[index];
    const x = lerp(from.x, to.x, flying.progress);
    const y = lerp(from.y, to.y, flying.progress);
    drawCard(ctx, card, { x, y, width: cardSize.width, height: cardSize.height }, true);
  });
}

function drawCard(ctx: CanvasRenderingContext2D, card: string, rect: VisualRect, floating = false): void {
  ctx.save();
  if (rect.rotated) {
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.rotate(Math.PI / 2);
    drawCardFace(ctx, card, -rect.height / 2, -rect.width / 2, rect.height, rect.width, floating);
  } else {
    drawCardFace(ctx, card, rect.x, rect.y, rect.width, rect.height, floating);
  }
  ctx.restore();
}

function drawCardFace(ctx: CanvasRenderingContext2D, card: string, x: number, y: number, width: number, height: number, floating: boolean): void {
  const decoded = decodeCard(card);
  const isMajor = decoded.kind === "major";
  const color = isMajor ? "#d99a4f" : SUITS[decoded.suitIndex].color;
  if (floating) {
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 18;
  }
  drawRoundedRect(ctx, x, y, width, height, 4, isMajor ? "#1f1b1c" : "#f6e2b7", color, 5);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = color;
  const cornerBaseline = y + Math.round(width * 0.19);
  const cornerInset = Math.round(width * 0.09);
  ctx.font = `700 ${Math.round(width * 0.19)}px Georgia`;
  ctx.fillText(isMajor ? String(decoded.rank) : rankText(decoded.rank), x + cornerInset, cornerBaseline);
  if (!isMajor) {
    const suit = SUITS[decoded.suitIndex];
    ctx.fillText(suit.symbol, x + width - Math.round(width * 0.26), cornerBaseline);
    ctx.globalAlpha = 0.78;
    ctx.font = `${Math.round(width * 0.18)}px Georgia`;
    const count = Math.min(decoded.rank, 10);
    for (let i = 0; i < count; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      ctx.fillText(suit.symbol, x + width * (0.34 + col * 0.32), y + height * 0.28 + row * 38);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = "#2e2725";
    ctx.beginPath();
    ctx.arc(x + width / 2, y + height / 2, width * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = `800 ${Math.round(width * 0.34)}px Georgia`;
    ctx.textAlign = "center";
    ctx.fillText(String(decoded.rank), x + width / 2, y + height / 2 + 38);
    ctx.textAlign = "start";
  }
  ctx.fillStyle = "rgba(37,21,18,0.92)";
  ctx.fillRect(x + 8, y + height - 46, width - 16, 36);
  ctx.fillStyle = "#ffd88d";
  ctx.font = `700 ${Math.round(width * 0.075)}px Georgia`;
  ctx.textAlign = "center";
  ctx.fillText(isMajor ? MAJOR_NAMES[decoded.rank] ?? "Major" : `${rankText(decoded.rank)} ${SUITS[decoded.suitIndex].name}`, x + width / 2, y + height - 21);
  ctx.textAlign = "start";
}

function drawEmptySlot(
  ctx: CanvasRenderingContext2D,
  rect: VisualRect,
  style: { fill?: string; stroke?: string } = {},
): void {
  ctx.save();
  if (rect.rotated) {
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.rotate(Math.PI / 2);
    drawSlotFace(ctx, -rect.height / 2, -rect.width / 2, rect.height, rect.width, style);
  } else {
    drawSlotFace(ctx, rect.x, rect.y, rect.width, rect.height, style);
  }
  ctx.restore();
}

function drawSlotFace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  style: { fill?: string; stroke?: string },
): void {
  ctx.setLineDash([14, 14]);
  drawRoundedRect(ctx, x, y, width, height, 4, style.fill ?? "rgba(40,20,18,0.36)", style.stroke ?? "rgba(220,151,78,0.8)", 4);
  ctx.setLineDash([]);
}

function drawHighlight(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.save();
  ctx.strokeStyle = "#fff0a2";
  ctx.lineWidth = 8;
  ctx.fillStyle = "rgba(255,218,99,0.12)";
  ctx.fillRect(rect.x - 8, rect.y - 8, rect.width + 16, rect.height + 16);
  ctx.strokeRect(rect.x - 8, rect.y - 8, rect.width + 16, rect.height + 16);
  ctx.restore();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke: string,
  lineWidth: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + size);
  ctx.lineTo(x - size, y - size);
  ctx.lineTo(x + size, y - size);
  ctx.closePath();
  ctx.fill();
}

function rankText(rank: number): string {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}
