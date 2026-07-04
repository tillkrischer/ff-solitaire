import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyManualOnly,
  canMoveToFoundation,
  canStackOn,
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
type GameMode = "single-card" | "entire-stack";

type AutoMove = {
  card: string;
  from: SourceLocation;
  foundation: FoundationTarget;
};

type StackMove = {
  fromIndex: number;
  toIndex: number;
  cards: string[];
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
  hiddenSource: SourceLocation;
  progress: number;
};

type FlyingStack = {
  cards: string[];
  from: VisualRect[];
  to: VisualRect[];
  hiddenSource: { columnIndex: number; startIndex: number; count: number };
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
const BOARD_HEIGHT = 1790;
const AUTO_MOVE_MS = 360;
const REDUCED_MOTION_MS = 30;
const CARD_MOVE_SOUND_INTERVAL_MS = 55;
const MAJOR_FOUNDATION_BACK_OFFSET = 36;
const MAJOR_FOUNDATION_MAX_BACKS = 7;
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
  const [gameMode, setGameMode] = useState<GameMode>("single-card");
  const [isResolving, setIsResolving] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [flyingCard, setFlyingCard] = useState<FlyingCard | null>(null);
  const [flyingStack, setFlyingStack] = useState<FlyingStack | null>(null);
  const [previousState, setPreviousState] = useState<State | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const previousStateRef = useRef<State | null>(previousState);
  const isResolvingRef = useRef(isResolving);
  const dragRef = useRef<DragState | null>(drag);
  const flyingCardRef = useRef<FlyingCard | null>(flyingCard);
  const flyingStackRef = useRef<FlyingStack | null>(flyingStack);
  const geometryRef = useRef<BoardGeometry>(makeGeometry());
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    previousStateRef.current = previousState;
  }, [previousState]);

  useEffect(() => {
    isResolvingRef.current = isResolving;
  }, [isResolving]);

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
    renderBoard(ctx, geometryRef.current, stateRef.current, dragRef.current, flyingCardRef.current, flyingStackRef.current);
  }, []);

  useLayoutEffect(() => {
    dragRef.current = drag;
    flyingCardRef.current = flyingCard;
    flyingStackRef.current = flyingStack;
    draw();
  }, [draw, state, drag, flyingCard, flyingStack]);

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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        if (isResolvingRef.current || dragRef.current || !previousStateRef.current) return;
        event.preventDefault();
        undoMove();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  function startNewDeal(): void {
    const nextDeal = generateDeal({ strategy: selectedStrategy, seed: Date.now() });
    const nextState = parseBoard(nextDeal.board);
    setDeal(nextDeal);
    stateRef.current = nextState;
    setState(nextState);
    previousStateRef.current = null;
    setPreviousState(null);
    setDragState(null);
    setFlyingCardFrame(null);
    setFlyingStackFrame(null);
    setIsResolving(false);
  }

  function undoMove(): void {
    const snapshot = previousStateRef.current;
    if (isResolvingRef.current || !snapshot) return;

    const restored = cloneState(snapshot);
    stateRef.current = restored;
    previousStateRef.current = null;
    setState(restored);
    setPreviousState(null);
    setDragState(null);
    setFlyingCardFrame(null);
    setFlyingStackFrame(null);
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
    setDragState({
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
    setDragState((current) => {
      if (!current) return null;
      return {
        ...current,
        pointer: point,
        horizontal: point.y - current.pointerOffset.y < geometryRef.current.tableau.y - geometryRef.current.card.height / 2,
      };
    });
  }

  async function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>): Promise<void> {
    const currentDragState = dragRef.current;
    if (!currentDragState) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const point = toBoardPoint(event);
    const currentDrag = {
      ...currentDragState,
      pointer: point,
      horizontal: point.y - currentDragState.pointerOffset.y < geometryRef.current.tableau.y - 3 * geometryRef.current.card.height / 4,
    };
    const destination = findDropByOverlap(stateRef.current, geometryRef.current, currentDrag);
    const source = currentDragState.source;
    const move = destination
      ? currentDragState.validMoves.find((candidate) => candidate.toType === destination.type && candidate.toIndex === destination.index)
      : null;
    if (!move) {
      setDragState(null);
      return;
    }

    const beforeManualState = stateRef.current;
    const undoSnapshot = cloneState(beforeManualState);
    previousStateRef.current = undoSnapshot;
    setPreviousState(undoSnapshot);
    const manualState = applyManualOnly(beforeManualState, move);
    stateRef.current = manualState;
    setState(manualState);
    playCardMoveSound();
    setDragState(null);
    setIsResolving(true);
    const stackState =
      gameMode === "entire-stack" ? await resolveEntireStackMove(beforeManualState, manualState, move) : manualState;
    await resolveAutomaticMoves(stackState, source);
    setIsResolving(false);
  }

  async function resolveEntireStackMove(beforeManualState: State, manualState: State, move: Move): Promise<State> {
    const stackMove = getEntireStackMove(beforeManualState, manualState, move);
    if (!stackMove) return manualState;

    await animateStackMove(manualState, stackMove);
    const next = applyStackMove(manualState, stackMove);
    stateRef.current = next;
    setState(next);
    playCardMoveSound(stackMove.cards.length);
    setFlyingStackFrame(null);
    return next;
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
      playCardMoveSound();
      lastSource = nextMove.from;
      if (!findNextAutoMove(current)) setFlyingCardFrame(null);
    }
  }

  function playCardMoveSound(count = 1): void {
    const audio = getAudioContext();
    if (!audio) return;
    if (audio.state === "suspended") void audio.resume();

    const now = audio.currentTime;
    for (let index = 0; index < count; index++) {
      playCardTick(audio, now + (index * CARD_MOVE_SOUND_INTERVAL_MS) / 1000, index);
    }
  }

  function getAudioContext(): AudioContext | null {
    if (audioContextRef.current) return audioContextRef.current;
    try {
      audioContextRef.current = new AudioContext();
      return audioContextRef.current;
    } catch {
      return null;
    }
  }

  async function animateAutoMove(current: State, move: AutoMove, fallbackSource: SourceLocation): Promise<void> {
    const geometry = geometryRef.current;
    const from = getSourceRect(current, geometry, move.from) ?? getSourceRect(current, geometry, fallbackSource);
    const to = getFoundationRect(geometry, move.foundation, move.card);
    const durationMs = prefersReducedMotion() ? REDUCED_MOTION_MS : AUTO_MOVE_MS;
    if (!from) {
      await delay(durationMs);
      return;
    }
    const animationFrom = from;
    const animationTo = to;
    const initialFlyingCard: FlyingCard = {
      card: move.card,
      from: animationFrom,
      to: animationTo,
      hiddenSource: move.from,
      progress: 0,
    };

    setFlyingCardFrame(initialFlyingCard);

    await new Promise<void>((resolve) => {
      const start = performance.now();
      function frame(now: number): void {
        const progress = Math.min(1, (now - start) / durationMs);
        setFlyingCardFrame({
          ...initialFlyingCard,
          progress: easeOut(progress),
        });
        if (progress < 1) requestAnimationFrame(frame);
        else {
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  async function animateStackMove(current: State, move: StackMove): Promise<void> {
    const geometry = geometryRef.current;
    const fromColumn = current.tableau[move.fromIndex];
    const destinationColumn = current.tableau[move.toIndex];
    const sourceStartIndex = fromColumn.length - move.cards.length;
    const destinationStartIndex = destinationColumn.length;
    const from = move.cards.map((_, index) => getColumnCardRect(geometry, move.fromIndex, fromColumn.length - 1 - index));
    const to = move.cards.map((_, index) => getColumnCardRect(geometry, move.toIndex, destinationStartIndex + index));
    const durationMs = prefersReducedMotion() ? REDUCED_MOTION_MS : AUTO_MOVE_MS;
    const initialFlyingStack: FlyingStack = {
      cards: move.cards,
      from,
      to,
      hiddenSource: { columnIndex: move.fromIndex, startIndex: sourceStartIndex, count: move.cards.length },
      progress: 0,
    };

    setFlyingStackFrame(initialFlyingStack);

    await new Promise<void>((resolve) => {
      const start = performance.now();
      function frame(now: number): void {
        const progress = Math.min(1, (now - start) / durationMs);
        setFlyingStackFrame({
          ...initialFlyingStack,
          progress: easeOut(progress),
        });
        if (progress < 1) requestAnimationFrame(frame);
        else {
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function setDragState(next: DragState | null | ((current: DragState | null) => DragState | null)): void {
    const resolved = typeof next === "function" ? next(dragRef.current) : next;
    dragRef.current = resolved;
    setDrag(resolved);
    draw();
  }

  function setFlyingCardFrame(next: FlyingCard | null): void {
    flyingCardRef.current = next;
    setFlyingCard(next);
    draw();
  }

  function setFlyingStackFrame(next: FlyingStack | null): void {
    flyingStackRef.current = next;
    setFlyingStack(next);
    draw();
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
        <button type="button" disabled={isResolving || !previousState} onClick={undoMove}>
          Undo
        </button>
        <fieldset className="mode-toggle" disabled={isResolving}>
          <legend>Mode</legend>
          <label>
            <input
              type="radio"
              name="game-mode"
              value="single-card"
              checked={gameMode === "single-card"}
              onChange={() => setGameMode("single-card")}
            />
            <span>Single card</span>
          </label>
          <label>
            <input
              type="radio"
              name="game-mode"
              value="entire-stack"
              checked={gameMode === "entire-stack"}
              onChange={() => setGameMode("entire-stack")}
            />
            <span>Entire stack</span>
          </label>
        </fieldset>
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
          onPointerCancel={() => setDragState(null)}
        />
      </div>
    </main>
  );
}

function playCardTick(audio: AudioContext, startTime: number, sequenceIndex: number): void {
  const duration = 0.09;
  const gain = audio.createGain();
  const filter = audio.createBiquadFilter();
  const oscillator = audio.createOscillator();
  const noise = audio.createBufferSource();
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
  const samples = buffer.getChannelData(0);

  for (let index = 0; index < samples.length; index++) {
    const fade = 1 - index / samples.length;
    samples[index] = (Math.random() * 2 - 1) * fade * 0.35;
  }

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(950 + sequenceIndex * 35, startTime);
  filter.Q.setValueAtTime(1.6, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.08, startTime + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(220 + sequenceIndex * 14, startTime);
  oscillator.frequency.exponentialRampToValueAtTime(150 + sequenceIndex * 10, startTime + duration);
  noise.buffer = buffer;

  oscillator.connect(gain);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);

  oscillator.start(startTime);
  noise.start(startTime);
  oscillator.stop(startTime + duration);
  noise.stop(startTime + duration);
}

function makeGeometry(): BoardGeometry {
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

function renderBoard(
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

function getColumnCardRect(geometry: BoardGeometry, columnIndex: number, cardIndex: number): VisualRect {
  const column = geometry.columns[columnIndex];
  return {
    x: column.x,
    y: column.y + cardIndex * geometry.stackOffset,
    width: geometry.card.width,
    height: geometry.card.height,
  };
}

function getEmptyColumnDropRect(geometry: BoardGeometry, columnIndex: number): VisualRect {
  const column = geometry.columns[columnIndex];
  return {
    x: column.x,
    y: column.y,
    width: geometry.card.width,
    height: geometry.card.height,
  };
}

function getDragCardRect(geometry: BoardGeometry, drag: DragState): VisualRect {
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

function findDropByOverlap(state: State, geometry: BoardGeometry, drag: DragState): DropLocation | null {
  const dragRect = getDragCardRect(geometry, drag);
  let closest: { location: DropLocation; distance: number } | null = null;

  for (const move of drag.validMoves) {
    const location = { type: move.toType, index: move.toIndex } as DropLocation;
    const targetRect = getDropTargetRect(state, geometry, location);
    if (!targetRect || !intersects(dragRect, targetRect)) continue;

    const distance = centerDistanceSquared(dragRect, targetRect);
    if (!closest || distance < closest.distance) closest = { location, distance };
  }

  return closest?.location ?? null;
}

function getDropTargetRect(state: State, geometry: BoardGeometry, location: DropLocation): VisualRect | null {
  if (location.type === "park") return geometry.park;

  const column = state.tableau[location.index];
  if (!column) return null;
  if (column.length === 0) return getEmptyColumnDropRect(geometry, location.index);
  return getColumnCardRect(geometry, location.index, column.length - 1);
}

function getSourceRect(state: State, geometry: BoardGeometry, source: SourceLocation): VisualRect | null {
  if (source.type === "park") return state.park ? geometry.park : null;
  const column = state.tableau[source.index];
  if (column.length === 0) return null;
  return getColumnCardRect(geometry, source.index, column.length - 1);
}

function getFoundationRect(geometry: BoardGeometry, foundation: FoundationTarget, card: string): VisualRect {
  if (foundation === "major-low") {
    const decoded = decodeCard(card);
    const countAfterMove = decoded.kind === "major" ? decoded.rank + 1 : 0;
    return { ...geometry.majorLow, x: getMajorFoundationTopX(geometry.majorLow, "low", countAfterMove) };
  }
  if (foundation === "major-high") {
    const decoded = decodeCard(card);
    const countAfterMove = decoded.kind === "major" ? 22 - decoded.rank : 0;
    return { ...geometry.majorHigh, x: getMajorFoundationTopX(geometry.majorHigh, "high", countAfterMove) };
  }
  return geometry.minorFoundations[Number(foundation.split("-")[1])];
}

function getMajorFoundationTopX(rect: VisualRect, direction: "low" | "high", count: number): number {
  const visibleBacks = majorFoundationVisibleBacks(count);
  return direction === "low"
    ? rect.x + visibleBacks * MAJOR_FOUNDATION_BACK_OFFSET
    : rect.x - visibleBacks * MAJOR_FOUNDATION_BACK_OFFSET;
}

function majorFoundationVisibleBacks(count: number): number {
  return Math.min(Math.max(0, count - 1), MAJOR_FOUNDATION_MAX_BACKS);
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

function getEntireStackMove(beforeManualState: State, manualState: State, move: Move): StackMove | null {
  if (move.fromType !== "column" || move.toType !== "column") return null;

  const sourceColumnBeforeMove = beforeManualState.tableau[move.fromIndex];
  const movedCard = sourceColumnBeforeMove[sourceColumnBeforeMove.length - 1];
  if (!movedCard || sourceColumnBeforeMove.length < 2) return null;

  const cards: string[] = [];
  let cardAbove = movedCard;
  for (let index = sourceColumnBeforeMove.length - 2; index >= 0; index--) {
    const candidate = sourceColumnBeforeMove[index];
    if (!canStackOn(candidate, cardAbove)) break;
    cards.push(candidate);
    cardAbove = candidate;
  }

  if (cards.length === 0 || manualState.tableau[move.fromIndex].length < cards.length) return null;
  return { fromIndex: move.fromIndex, toIndex: move.toIndex, cards };
}

function applyStackMove(state: State, move: StackMove): State {
  const next = cloneState(state);
  next.tableau[move.fromIndex].splice(next.tableau[move.fromIndex].length - move.cards.length);
  next.tableau[move.toIndex].push(...move.cards);
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

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function centerDistanceSquared(a: Rect, b: Rect): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return (ax - bx) ** 2 + (ay - by) ** 2;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
