import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyManualOnly,
  canMoveToFoundation,
  canStackOn,
  cloneState,
  decodeCard,
  getValidMoves,
  moveCardToFoundation,
  parseBoard,
  type Move,
  type State,
} from "../game.ts";
import { generateDeal, listGenerationStrategies, type GenerateDealResult } from "../generator.ts";
import { SolitaireCanvas } from "./SolitaireCanvas.tsx";
import { Toolbar } from "./Toolbar.tsx";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  getColumnCardRect,
  getDragCardRect,
  getEmptyColumnDropRect,
  getMajorFoundationTopX,
  makeGeometry,
} from "./boardGeometry.ts";
import { renderBoard } from "./boardDrawing.ts";
import type {
  BoardGeometry,
  DragState,
  DropLocation,
  FlyingCard,
  FlyingStack,
  FoundationTarget,
  GameMode,
  SourceLocation,
  VisualRect,
} from "./types.ts";
import { centerDistanceSquared, contains, intersects } from "./utils.ts";

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

const AUTO_MOVE_MS = 360;
const REDUCED_MOTION_MS = 30;
const CARD_MOVE_SOUND_INTERVAL_MS = 55;
const SELECTED_STRATEGY_STORAGE_KEY = "ff-solitaire:selected-strategy";
const GAME_MODE_STORAGE_KEY = "ff-solitaire:game-mode";
const SOUND_ENABLED_STORAGE_KEY = "ff-solitaire:sound-enabled";
const PAGE_BACKGROUND = {
  backgroundImage:
    "linear-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px)",
  backgroundSize: "24px 24px",
};

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preference persistence should not block gameplay.
  }
}

function getInitialStrategy(strategies: string[]): string {
  const fallback = "inline-test-deal";
  const storedStrategy = readLocalStorage(SELECTED_STRATEGY_STORAGE_KEY);
  return storedStrategy && strategies.includes(storedStrategy) ? storedStrategy : fallback;
}

function getInitialGameMode(): GameMode {
  const storedMode = readLocalStorage(GAME_MODE_STORAGE_KEY);
  return storedMode === "single-card" || storedMode === "entire-stack" ? storedMode : "single-card";
}

function getInitialSoundEnabled(): boolean {
  return readLocalStorage(SOUND_ENABLED_STORAGE_KEY) !== "false";
}

export function CanvasV1App(): JSX.Element {
  const strategies = useMemo(() => listGenerationStrategies(), []);
  const initialStrategy = useMemo(() => getInitialStrategy(strategies), [strategies]);
  const [selectedStrategy, setSelectedStrategy] = useState(initialStrategy);
  const [deal, setDeal] = useState<GenerateDealResult>(() => generateDeal({ strategy: initialStrategy }));
  const [state, setState] = useState<State>(() => parseBoard(deal.board));
  const [gameMode, setGameMode] = useState<GameMode>(() => getInitialGameMode());
  const [soundEnabled, setSoundEnabled] = useState(() => getInitialSoundEnabled());
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
  const soundEnabledRef = useRef(soundEnabled);
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

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    writeLocalStorage(SELECTED_STRATEGY_STORAGE_KEY, selectedStrategy);
  }, [selectedStrategy]);

  useEffect(() => {
    writeLocalStorage(GAME_MODE_STORAGE_KEY, gameMode);
  }, [gameMode]);

  useEffect(() => {
    writeLocalStorage(SOUND_ENABLED_STORAGE_KEY, String(soundEnabled));
  }, [soundEnabled]);

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
    if (!soundEnabledRef.current) return;
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
    <main
      className="grid min-h-screen grid-rows-[auto_1fr] gap-2.5 overflow-hidden bg-[#050505] p-2.5 font-ui text-[#ffe4b5] [color-scheme:dark]"
      style={PAGE_BACKGROUND}
    >
      <Toolbar
        strategies={strategies}
        selectedStrategy={selectedStrategy}
        gameMode={gameMode}
        soundEnabled={soundEnabled}
        isResolving={isResolving}
        canUndo={Boolean(previousState)}
        onNewDeal={startNewDeal}
        onSelectedStrategyChange={setSelectedStrategy}
        onUndo={undoMove}
        onGameModeChange={setGameMode}
        onSoundEnabledChange={setSoundEnabled}
      />
      <SolitaireCanvas
        wrapRef={wrapRef}
        canvasRef={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDragState(null)}
      />
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

function easeOut(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
