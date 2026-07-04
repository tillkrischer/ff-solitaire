import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyManualOnly,
  canMoveToFoundation,
  cloneState,
  decodeCard,
  getValidMoves,
  isGoalState,
  moveCardToFoundation,
  parseBoard,
  type Move,
  type State,
} from "../game.ts";
import { generateDeal, listGenerationStrategies, type GenerateDealResult } from "../generator.ts";

type SourceLocation = { type: "column"; index: number } | { type: "park"; index: 0 };
type DropLocation = { type: "column"; index: number } | { type: "park"; index: 0 };
type FoundationTarget = "major-low" | "major-high" | `minor-${number}`;

type AutoMove = {
  card: string;
  from: SourceLocation;
  foundation: FoundationTarget;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type VisualRect = Rect & {
  rotated?: boolean;
};

type DragState = {
  source: SourceLocation;
  card: string;
  pointerOffset: { x: number; y: number };
  pointer: { x: number; y: number };
  horizontal: boolean;
  validMoves: Move[];
};

type FlyingCard = {
  card: string;
  from: VisualRect;
  to: VisualRect;
  progress: number;
};

type BoardGeometry = {
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

const BOARD_WIDTH = 2868;
const BOARD_HEIGHT = 2040;
const AUTO_MOVE_MS = 360;
const REDUCED_MOTION_MS = 30;
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

export function CanvasV1App(): JSX.Element {
  const strategies = useMemo(() => listGenerationStrategies(), []);
  const [selectedStrategy, setSelectedStrategy] = useState(strategies[0] ?? "one-move-constructive");
  const [deal, setDeal] = useState<GenerateDealResult>(() => generateDeal({ strategy: strategies[0] }));
  const [state, setState] = useState<State>(() => parseBoard(deal.board));
  const [isResolving, setIsResolving] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [flyingCard, setFlyingCard] = useState<FlyingCard | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const geometryRef = useRef<BoardGeometry>(makeGeometry());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const cssWidth = wrap.clientWidth;
    const cssHeight = Math.max(360, Math.min(window.innerHeight - wrap.getBoundingClientRect().top - 12, cssWidth * (BOARD_HEIGHT / BOARD_WIDTH)));
    const scale = Math.min(cssWidth / BOARD_WIDTH, cssHeight / BOARD_HEIGHT);
    const deviceRatio = window.devicePixelRatio || 1;
    canvas.style.width = `${Math.round(BOARD_WIDTH * scale)}px`;
    canvas.style.height = `${Math.round(BOARD_HEIGHT * scale)}px`;
    canvas.width = Math.round(BOARD_WIDTH * scale * deviceRatio);
    canvas.height = Math.round(BOARD_HEIGHT * scale * deviceRatio);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale * deviceRatio, 0, 0, scale * deviceRatio, 0, 0);
    geometryRef.current = makeGeometry();
    renderBoard(ctx, geometryRef.current, stateRef.current, drag, flyingCard, isResolving);
  }, [drag, flyingCard, isResolving]);

  useEffect(() => {
    draw();
  }, [draw, state]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrap);
    window.addEventListener("resize", draw);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [draw]);

  function startNewDeal(): void {
    const nextDeal = generateDeal({ strategy: selectedStrategy, seed: Date.now() });
    setDeal(nextDeal);
    setState(parseBoard(nextDeal.board));
    setDrag(null);
    setFlyingCard(null);
    setIsResolving(false);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (isResolving) return;
    const point = toBoardPoint(event);
    const source = findSourceAtPoint(stateRef.current, geometryRef.current, point);
    if (!source) return;
    const card = getCardAtSource(stateRef.current, source.location);
    if (!card) return;
    const validMoves = getValidMoves(stateRef.current).filter(
      (move) => move.fromType === source.location.type && move.fromIndex === source.location.index,
    );
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      source: source.location,
      card,
      pointerOffset: { x: point.x - source.rect.x, y: point.y - source.rect.y },
      pointer: point,
      horizontal: source.rect.rotated ?? false,
      validMoves,
    });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    const point = toBoardPoint(event);
    setDrag((current) => {
      if (!current) return null;
      return {
        ...current,
        pointer: point,
        horizontal: point.y - current.pointerOffset.y < geometryRef.current.tableau.y,
      };
    });
  }

  async function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>): Promise<void> {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const point = toBoardPoint(event);
    const destination = findDropAtPoint(geometryRef.current, point, drag.validMoves);
    const source = drag.source;
    const move = destination
      ? drag.validMoves.find((candidate) => candidate.toType === destination.type && candidate.toIndex === destination.index)
      : null;
    setDrag(null);
    if (!move) return;

    const manualState = applyManualOnly(stateRef.current, move);
    stateRef.current = manualState;
    setState(manualState);
    setIsResolving(true);
    await waitForPaint();
    await resolveAutomaticMoves(manualState, source);
    setIsResolving(false);
  }

  async function resolveAutomaticMoves(startState: State, manualSource: SourceLocation): Promise<void> {
    let current = startState;
    let lastSource = manualSource;
    while (true) {
      const nextMove = findNextAutoMove(current);
      if (!nextMove) break;
      await animateAutoMove(current, nextMove, lastSource);
      current = applySingleAutoMove(current, nextMove);
      stateRef.current = current;
      setState(current);
      lastSource = nextMove.from;
      await waitForPaint();
    }
  }

  async function animateAutoMove(current: State, move: AutoMove, fallbackSource: SourceLocation): Promise<void> {
    const geometry = geometryRef.current;
    const from = getSourceRect(current, geometry, move.from) ?? getSourceRect(current, geometry, fallbackSource);
    const to = getFoundationRect(geometry, move.foundation);
    const durationMs = prefersReducedMotion() ? REDUCED_MOTION_MS : AUTO_MOVE_MS;
    if (!from) {
      await delay(durationMs);
      return;
    }
    const animationFrom = from;
    const animationTo = to;

    await new Promise<void>((resolve) => {
      const start = performance.now();
      function frame(now: number): void {
        const progress = Math.min(1, (now - start) / durationMs);
        setFlyingCard({ card: move.card, from: animationFrom, to: animationTo, progress: easeOut(progress) });
        if (progress < 1) requestAnimationFrame(frame);
        else {
          setFlyingCard(null);
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function toBoardPoint(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * BOARD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * BOARD_HEIGHT,
    };
  }

  return (
    <main className="canvas-v1-page">
      <section className="canvas-controls" aria-label="Canvas controls">
        <a href="/" className="version-link">
          Versions
        </a>
        <label>
          <span>Deal strategy</span>
          <select value={selectedStrategy} disabled={isResolving} onChange={(event) => setSelectedStrategy(event.target.value)}>
            {strategies.map((strategy) => (
              <option key={strategy} value={strategy}>
                {strategy}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={isResolving} onClick={startNewDeal}>
          New Deal
        </button>
        <dl>
          <div>
            <dt>Seed</dt>
            <dd>{deal.seed}</dd>
          </div>
          <div>
            <dt>Attempts</dt>
            <dd>{deal.attempts}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{isGoalState(state) ? "Won" : isResolving ? "Resolving" : "Playing"}</dd>
          </div>
        </dl>
      </section>
      <div ref={wrapRef} className="canvas-board-wrap">
        <canvas
          ref={canvasRef}
          className="canvas-board"
          aria-label="Canvas solitaire board"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => setDrag(null)}
        />
      </div>
    </main>
  );
}

function makeGeometry(): BoardGeometry {
  const card = { width: 198, height: 340 };
  const columnGap = 44;
  const startX = 126;
  const tableauY = 805;
  const columns = Array.from({ length: 11 }, (_, index) => ({
    x: startX + index * (card.width + columnGap),
    y: tableauY,
    width: card.width,
    height: 1000,
  }));
  const minorFoundations = [1900, 2128, 2356, 2584].map((x) => ({
    x,
    y: 360,
    width: card.width,
    height: card.height,
  }));
  return {
    board: { x: 0, y: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT },
    topBand: { x: 0, y: 250, width: BOARD_WIDTH, height: 520 },
    tableau: { x: 0, y: tableauY, width: BOARD_WIDTH, height: 1090 },
    card,
    stackOffset: 48,
    columns,
    minorFoundations,
    park: { x: 2117, y: 430, width: card.height, height: card.width, rotated: true },
    majorLow: { x: 130, y: 360, width: card.width, height: card.height },
    majorHigh: { x: 820, y: 360, width: card.width, height: card.height },
  };
}

function renderBoard(
  ctx: CanvasRenderingContext2D,
  geometry: BoardGeometry,
  state: State,
  drag: DragState | null,
  flyingCard: FlyingCard | null,
  isResolving: boolean,
): void {
  drawBackground(ctx, geometry);
  const hiddenKey = drag ? sourceKey(drag.source) : null;
  const validDrops = new Set(drag?.validMoves.map((move) => dropKey({ type: move.toType, index: move.toIndex } as DropLocation)) ?? []);
  drawMajorFoundationStack(ctx, geometry.majorLow, "low", state.majorLow, geometry.card);
  drawMajorFoundationStack(ctx, geometry.majorHigh, "high", state.majorHigh, geometry.card);
  drawMinorFoundations(ctx, geometry, state);
  drawPark(ctx, geometry, state, hiddenKey, validDrops);
  drawTableau(ctx, geometry, state, hiddenKey, validDrops);

  if (flyingCard) drawFlyingCard(ctx, flyingCard, geometry.card);
  if (drag) drawDragCard(ctx, geometry, drag);
  if (isResolving) drawResolvingVeil(ctx);
}

function drawBackground(ctx: CanvasRenderingContext2D, geometry: BoardGeometry): void {
  ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.fillStyle = "#20110d";
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.fillStyle = "#6f211a";
  ctx.fillRect(0, geometry.topBand.y, BOARD_WIDTH, geometry.topBand.height);
  ctx.fillStyle = "#2a1a12";
  ctx.fillRect(0, geometry.tableau.y, BOARD_WIDTH, BOARD_HEIGHT - geometry.tableau.y);
  ctx.fillStyle = "rgba(195,110,52,0.55)";
  for (let x = 80; x < BOARD_WIDTH; x += 70) {
    for (let y = geometry.tableau.y + 28; y < BOARD_HEIGHT - 120; y += 70) {
      ctx.fillText("✦", x, y);
    }
  }
  ctx.strokeStyle = "#a8632c";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, geometry.tableau.y);
  ctx.lineTo(BOARD_WIDTH, geometry.tableau.y);
  ctx.stroke();
  ctx.fillStyle = "#bd7030";
  for (let x = 115; x < BOARD_WIDTH - 80; x += 72) drawTriangle(ctx, x, geometry.topBand.y + 28, 26);
  ctx.fillStyle = "#f0b066";
  ctx.font = "700 42px Georgia";
  ctx.fillText("WINS", 90, BOARD_HEIGHT - 210);
  drawRoundedRect(ctx, 90, BOARD_HEIGHT - 170, 150, 68, 10, "#4c0d17", "#efb768", 6);
  ctx.fillStyle = "#f0b066";
  ctx.textAlign = "center";
  ctx.fillText("15", 165, BOARD_HEIGHT - 124);
  ctx.textAlign = "start";
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
    drawEmptySlot(ctx, rect, "MAJOR");
    return;
  }
  const count = direction === "low" ? rank + 1 : 22 - rank;
  const visibleBacks = Math.min(Math.max(0, count - 1), 7);
  const offset = 36;
  for (let i = 0; i < visibleBacks; i++) {
    const x = direction === "low" ? rect.x + i * offset : rect.x - i * offset;
    drawCardBack(ctx, { ...rect, x }, cardSize);
  }
  const topX = direction === "low" ? rect.x + visibleBacks * offset : rect.x - visibleBacks * offset;
  drawCard(ctx, `M${rank}`, { ...rect, x: topX });
}

function drawMinorFoundations(ctx: CanvasRenderingContext2D, geometry: BoardGeometry, state: State): void {
  geometry.minorFoundations.forEach((rect, index) => {
    drawCard(ctx, `${SUITS[index].code}${state.minor[index]}`, rect);
  });
}

function drawPark(ctx: CanvasRenderingContext2D, geometry: BoardGeometry, state: State, hiddenKey: string | null, validDrops: Set<string>): void {
  if (validDrops.has(dropKey({ type: "park", index: 0 }))) drawHighlight(ctx, geometry.park);
  if (state.park && hiddenKey !== sourceKey({ type: "park", index: 0 })) drawCard(ctx, state.park, geometry.park);
  if (!state.park) drawEmptySlot(ctx, geometry.park, "PARK");
}

function drawTableau(ctx: CanvasRenderingContext2D, geometry: BoardGeometry, state: State, hiddenKey: string | null, validDrops: Set<string>): void {
  state.tableau.forEach((column, index) => {
    const columnRect = geometry.columns[index];
    const drop = dropKey({ type: "column", index });
    if (validDrops.has(drop)) drawHighlight(ctx, { ...columnRect, height: geometry.card.height });
    if (column.length === 0) {
      drawEmptySlot(ctx, { ...columnRect, height: geometry.card.height }, "EMPTY");
      return;
    }
    column.forEach((card, cardIndex) => {
      const topCardHidden = cardIndex === column.length - 1 && hiddenKey === sourceKey({ type: "column", index });
      if (!topCardHidden) drawCard(ctx, card, getColumnCardRect(geometry, index, cardIndex));
    });
  });
}

function drawDragCard(ctx: CanvasRenderingContext2D, geometry: BoardGeometry, drag: DragState): void {
  const rect = drag.horizontal
    ? {
        x: drag.pointer.x - drag.pointerOffset.x,
        y: drag.pointer.y - drag.pointerOffset.y,
        width: geometry.card.height,
        height: geometry.card.width,
        rotated: true,
      }
    : {
        x: drag.pointer.x - drag.pointerOffset.x,
        y: drag.pointer.y - drag.pointerOffset.y,
        width: geometry.card.width,
        height: geometry.card.height,
      };
  drawCard(ctx, drag.card, rect, true);
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
  ctx.font = `700 ${Math.round(width * 0.19)}px Georgia`;
  ctx.fillText(isMajor ? String(decoded.rank) : rankText(decoded.rank), x + 18, y + 46);
  if (!isMajor) {
    const suit = SUITS[decoded.suitIndex];
    ctx.fillText(suit.symbol, x + width - 52, y + 46);
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

function drawCardBack(ctx: CanvasRenderingContext2D, rect: VisualRect, cardSize: { width: number; height: number }): void {
  drawRoundedRect(ctx, rect.x, rect.y, cardSize.width, cardSize.height, 4, "#231016", "#d8944f", 5);
  drawRoundedRect(ctx, rect.x + 22, rect.y + 24, cardSize.width - 44, cardSize.height - 48, 2, "#4c1018", "#f0b568", 4);
  ctx.fillStyle = "#f0b568";
  ctx.font = "700 74px Georgia";
  ctx.textAlign = "center";
  ctx.fillText("✦", rect.x + cardSize.width / 2, rect.y + cardSize.height / 2 + 24);
  ctx.textAlign = "start";
}

function drawEmptySlot(ctx: CanvasRenderingContext2D, rect: VisualRect, label: string): void {
  ctx.save();
  if (rect.rotated) {
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.rotate(Math.PI / 2);
    drawSlotFace(ctx, -rect.height / 2, -rect.width / 2, rect.height, rect.width, label);
  } else {
    drawSlotFace(ctx, rect.x, rect.y, rect.width, rect.height, label);
  }
  ctx.restore();
}

function drawSlotFace(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, label: string): void {
  ctx.setLineDash([14, 14]);
  drawRoundedRect(ctx, x, y, width, height, 4, "rgba(40,20,18,0.36)", "rgba(220,151,78,0.8)", 4);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,216,141,0.62)";
  ctx.font = `700 ${Math.round(width * 0.12)}px Georgia`;
  ctx.textAlign = "center";
  ctx.fillText(label, x + width / 2, y + height / 2);
  ctx.textAlign = "start";
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

function drawResolvingVeil(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
}

function findSourceAtPoint(state: State, geometry: BoardGeometry, point: { x: number; y: number }): { location: SourceLocation; rect: VisualRect } | null {
  if (state.park && contains(geometry.park, point)) return { location: { type: "park", index: 0 }, rect: geometry.park };
  for (let index = state.tableau.length - 1; index >= 0; index--) {
    const column = state.tableau[index];
    if (column.length === 0) continue;
    const rect = getColumnCardRect(geometry, index, column.length - 1);
    if (contains(rect, point)) return { location: { type: "column", index }, rect };
  }
  return null;
}

function findDropAtPoint(geometry: BoardGeometry, point: { x: number; y: number }, validMoves: Move[]): DropLocation | null {
  const validKeys = new Set(validMoves.map((move) => dropKey({ type: move.toType, index: move.toIndex } as DropLocation)));
  if (validKeys.has(dropKey({ type: "park", index: 0 })) && contains(geometry.park, point)) return { type: "park", index: 0 };
  for (let index = 0; index < geometry.columns.length; index++) {
    const column = geometry.columns[index];
    if (validKeys.has(dropKey({ type: "column", index })) && contains(column, point)) return { type: "column", index };
  }
  return null;
}

function getColumnCardRect(geometry: BoardGeometry, columnIndex: number, cardIndex: number): VisualRect {
  const column = geometry.columns[columnIndex];
  return {
    x: column.x,
    y: column.y + cardIndex * geometry.stackOffset,
    width: geometry.card.width,
    height: geometry.card.height,
  };
}

function getSourceRect(state: State, geometry: BoardGeometry, source: SourceLocation): VisualRect | null {
  if (source.type === "park") return state.park ? geometry.park : null;
  const column = state.tableau[source.index];
  if (column.length === 0) return null;
  return getColumnCardRect(geometry, source.index, column.length - 1);
}

function getFoundationRect(geometry: BoardGeometry, foundation: FoundationTarget): VisualRect {
  if (foundation === "major-low") return geometry.majorLow;
  if (foundation === "major-high") return geometry.majorHigh;
  return geometry.minorFoundations[Number(foundation.split("-")[1])];
}

function findNextAutoMove(state: State): AutoMove | null {
  if (state.park && canMoveToFoundation(state, state.park, true)) {
    return { card: state.park, from: { type: "park", index: 0 }, foundation: foundationForCard(state, state.park) };
  }
  for (let index = 0; index < state.tableau.length; index++) {
    const card = state.tableau[index][state.tableau[index].length - 1];
    if (card && canMoveToFoundation(state, card, false)) {
      return { card, from: { type: "column", index }, foundation: foundationForCard(state, card) };
    }
  }
  return null;
}

function applySingleAutoMove(state: State, move: AutoMove): State {
  const next = cloneState(state);
  if (move.from.type === "park") next.park = null;
  else next.tableau[move.from.index].pop();
  moveCardToFoundation(next, move.card);
  return next;
}

function foundationForCard(state: State, card: string): FoundationTarget {
  const decoded = decodeCard(card);
  if (decoded.kind === "minor") return `minor-${decoded.suitIndex}`;
  return decoded.rank === state.majorLow + 1 ? "major-low" : "major-high";
}

function getCardAtSource(state: State, source: SourceLocation): string | null {
  if (source.type === "park") return state.park;
  const column = state.tableau[source.index];
  return column[column.length - 1] ?? null;
}

function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
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

function sourceKey(source: SourceLocation): string {
  return `${source.type}:${source.index}`;
}

function dropKey(drop: DropLocation): string {
  return `${drop.type}:${drop.index}`;
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

function easeOut(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
