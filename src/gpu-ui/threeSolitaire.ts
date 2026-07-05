import * as THREE from "three";
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
import { DEFAULT_GENERATION_STRATEGY, generateDeal, listGenerationStrategies } from "../generator.ts";

type GameMode = "single-card" | "entire-stack";
type SourceLocation = { type: "column"; index: number } | { type: "park"; index: 0 };
type DropLocation = { type: "column"; index: number } | { type: "park"; index: 0 };
type FoundationTarget = "major-low" | "major-high" | `minor-${number}`;
type Rect = { x: number; y: number; width: number; height: number };
type VisualRect = Rect & { rotated?: boolean };
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
type DragState = {
  source: SourceLocation;
  card: string;
  pointerOffset: { x: number; y: number };
  pointer: { x: number; y: number };
  horizontal: boolean;
  validMoves: Move[];
};
type AutoMove = { card: string; from: SourceLocation; foundation: FoundationTarget };
type StackMove = { fromIndex: number; toIndex: number; cards: string[] };
type FlyingCard = { card: string; from: VisualRect; to: VisualRect; hiddenSource: SourceLocation; progress: number };
type FlyingStack = {
  cards: string[];
  from: VisualRect[];
  to: VisualRect[];
  hiddenSource: { columnIndex: number; startIndex: number; count: number };
  progress: number;
};
type ControlAction =
  | { type: "new-deal" }
  | { type: "undo" }
  | { type: "game-mode"; mode: GameMode }
  | { type: "sound"; enabled: boolean }
  | { type: "strategy-toggle"; strategy: string }
  | { type: "strategy-select"; strategy: string };
type ControlSurface = Rect & { action: ControlAction; disabled?: boolean };
type ControlLayout = { surfaces: ControlSurface[]; menuRect: Rect | null };

const BOARD_WIDTH = 2868;
const BOARD_HEIGHT = 1790;
const MAJOR_FOUNDATION_BACK_OFFSET = 36;
const MAJOR_FOUNDATION_MAX_BACKS = 7;
const ANIMATION_MS = 260;
const REDUCED_MOTION_MS = 30;
const CARD_MOVE_SOUND_INTERVAL_MS = 55;
const SELECTED_STRATEGY_STORAGE_KEY = "ff-solitaire:selected-strategy";
const GAME_MODE_STORAGE_KEY = "ff-solitaire:game-mode";
const SOUND_ENABLED_STORAGE_KEY = "ff-solitaire:sound-enabled";
const STACK_STAGGER_CAP_MS = 45;

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

export type ThreeSolitaireApp = {
  destroy: () => void;
};

export function createThreeSolitaireApp(mount: HTMLElement): ThreeSolitaireApp {
  return new ThreeSolitaireRuntime(mount);
}

class ThreeSolitaireRuntime implements ThreeSolitaireApp {
  private readonly mount: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.OrthographicCamera;
  private readonly scene = new THREE.Scene();
  private readonly boardGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly textureCache = new Map<string, THREE.Texture>();
  private readonly materials: THREE.Material[] = [];
  private readonly geometry = makeGeometry();
  private readonly resizeObserver: ResizeObserver;
  private readonly audioContext: { current: AudioContext | null } = { current: null };
  private readonly strategies = listGenerationStrategies();
  private readonly showStrategySelector = shouldShowStrategySelector();
  private state: State;
  private previousState: State | null = null;
  private selectedStrategy = getInitialStrategy(this.strategies, this.showStrategySelector);
  private gameMode = getInitialGameMode();
  private soundEnabled = getInitialSoundEnabled();
  private strategyMenuOpen = false;
  private drag: DragState | null = null;
  private flyingCard: FlyingCard | null = null;
  private flyingStack: FlyingStack | null = null;
  private isResolving = false;
  private animationFrame: number | null = null;
  private destroyed = false;

  constructor(mount: HTMLElement) {
    this.mount = mount;
    const deal = generateDeal({ strategy: this.selectedStrategy, seed: Date.now() });
    this.state = parseBoard(deal.board);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setClearColor(0x21110d, 1);
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.domElement.className =
      "block max-w-full touch-none border border-[rgba(237,175,92,0.5)] bg-[#21110d] shadow-[0_20px_60px_rgba(0,0,0,0.5)]";
    this.renderer.domElement.setAttribute("aria-label", "Three.js solitaire board");
    this.renderer.domElement.tabIndex = 0;
    this.camera = new THREE.OrthographicCamera(0, BOARD_WIDTH, BOARD_HEIGHT, 0, -1000, 1000);
    this.camera.position.z = 500;
    this.scene.add(this.boardGroup, this.overlayGroup);
    this.mount.appendChild(this.renderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.handleKeyDown);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.handlePointerCancel);
    this.resize();
    this.draw();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.handleKeyDown);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.removeEventListener("pointercancel", this.handlePointerCancel);
    void this.audioContext.current?.close();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textureCache.values()) texture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly resize = (): void => {
    const cssWidth = this.mount.clientWidth;
    const top = this.mount.getBoundingClientRect().top;
    const cssHeight = Math.max(360, Math.min(window.innerHeight - top - 12, cssWidth * (BOARD_HEIGHT / BOARD_WIDTH)));
    const scale = Math.min(cssWidth / BOARD_WIDTH, cssHeight / BOARD_HEIGHT);
    const width = Math.round(BOARD_WIDTH * scale);
    const height = Math.round(BOARD_HEIGHT * scale);
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = `${width}px`;
    this.renderer.domElement.style.height = `${height}px`;
    this.render();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      if (this.isResolving || this.drag || !this.previousState) return;
      event.preventDefault();
      this.undoMove();
    }
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    const point = this.toBoardPoint(event);
    if (this.handleControlPointerDown(point)) {
      event.preventDefault();
      return;
    }
    if (this.isResolving) return;
    const source = findSourceAtPoint(this.state, this.geometry, point);
    if (!source) return;
    const card = getCardAtSource(this.state, source.location);
    if (!card) return;
    const validMoves = getValidMoves(this.state).filter(
      (move) => move.fromType === source.location.type && move.fromIndex === source.location.index,
    );
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.drag = {
      source: source.location,
      card,
      pointerOffset: { x: point.x - source.rect.x, y: point.y - source.rect.y },
      pointer: point,
      horizontal: source.rect.rotated ?? false,
      validMoves,
    };
    this.draw();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.drag) return;
    const point = this.toBoardPoint(event);
    this.drag = {
      ...this.drag,
      pointer: point,
      horizontal: point.y - this.drag.pointerOffset.y < this.geometry.tableau.y - this.geometry.card.height / 2,
    };
    this.draw();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.drag) return;
    this.renderer.domElement.releasePointerCapture(event.pointerId);
    const point = this.toBoardPoint(event);
    const currentDrag = {
      ...this.drag,
      pointer: point,
      horizontal: point.y - this.drag.pointerOffset.y < this.geometry.tableau.y - (3 * this.geometry.card.height) / 4,
    };
    const destination = findDropByOverlap(this.state, this.geometry, currentDrag);
    const source = this.drag.source;
    const move = destination
      ? this.drag.validMoves.find((candidate) => candidate.toType === destination.type && candidate.toIndex === destination.index)
      : null;
    if (!move) {
      this.drag = null;
      this.draw();
      return;
    }
    void this.resolveManualMove(move, source);
  };

  private readonly handlePointerCancel = (): void => {
    this.drag = null;
    this.draw();
  };

  private async resolveManualMove(move: Move, source: SourceLocation): Promise<void> {
    const beforeManualState = this.state;
    this.previousState = cloneState(beforeManualState);
    const manualState = applyManualOnly(beforeManualState, move);
    this.state = manualState;
    this.drag = null;
    this.isResolving = true;
    this.playCardMoveSound();
    this.draw();
    const stackState = this.gameMode === "entire-stack" ? await this.resolveEntireStackMove(beforeManualState, manualState, move) : manualState;
    await this.resolveAutomaticMoves(stackState, source);
    this.isResolving = false;
    this.draw();
  }

  private undoMove(): void {
    if (!this.previousState || this.isResolving || this.drag) return;
    this.state = cloneState(this.previousState);
    this.previousState = null;
    this.drag = null;
    this.flyingCard = null;
    this.flyingStack = null;
    this.draw();
  }

  private startNewDeal(): void {
    if (this.isResolving) return;
    const deal = generateDeal({ strategy: this.selectedStrategy, seed: Date.now() });
    this.state = parseBoard(deal.board);
    this.previousState = null;
    this.drag = null;
    this.flyingCard = null;
    this.flyingStack = null;
    this.strategyMenuOpen = false;
    this.isResolving = false;
    this.draw();
  }

  private handleControlPointerDown(point: { x: number; y: number }): boolean {
    const layout = getControlLayout(this.strategies, this.showStrategySelector, this.strategyMenuOpen, this.selectedStrategy);
    const hit = findControlAtPoint(layout, point);
    if (!hit) {
      if (this.strategyMenuOpen) {
        this.strategyMenuOpen = false;
        this.draw();
        return true;
      }
      return false;
    }
    if (hit.disabled || this.isControlActionDisabled(hit.action)) return true;
    this.applyControlAction(hit.action);
    return true;
  }

  private isControlActionDisabled(action: ControlAction): boolean {
    if (this.isResolving) return true;
    return action.type === "undo" && !this.previousState;
  }

  private applyControlAction(action: ControlAction): void {
    switch (action.type) {
      case "new-deal":
        this.startNewDeal();
        break;
      case "undo":
        this.undoMove();
        break;
      case "game-mode":
        this.gameMode = action.mode;
        writeLocalStorage(GAME_MODE_STORAGE_KEY, action.mode);
        this.strategyMenuOpen = false;
        this.draw();
        break;
      case "sound":
        this.soundEnabled = action.enabled;
        writeLocalStorage(SOUND_ENABLED_STORAGE_KEY, String(action.enabled));
        this.strategyMenuOpen = false;
        this.draw();
        break;
      case "strategy-toggle":
        this.strategyMenuOpen = !this.strategyMenuOpen;
        this.draw();
        break;
      case "strategy-select":
        this.selectedStrategy = action.strategy;
        writeLocalStorage(SELECTED_STRATEGY_STORAGE_KEY, action.strategy);
        this.strategyMenuOpen = false;
        this.draw();
        break;
    }
  }

  private async resolveEntireStackMove(beforeManualState: State, manualState: State, move: Move): Promise<State> {
    const stackMove = getEntireStackMove(beforeManualState, manualState, move);
    if (!stackMove) return manualState;
    await this.animateStackMove(manualState, stackMove);
    const next = applyStackMove(manualState, stackMove);
    this.state = next;
    this.flyingStack = null;
    this.playCardMoveSound(stackMove.cards.length);
    this.draw();
    return next;
  }

  private async resolveAutomaticMoves(startState: State, manualSource: SourceLocation): Promise<void> {
    let current = startState;
    let lastSource = manualSource;
    while (!this.destroyed) {
      const nextMove = findNextAutoMove(current);
      if (!nextMove) break;
      await this.animateAutoMove(current, nextMove, lastSource);
      current = applySingleAutoMove(current, nextMove);
      this.state = current;
      this.playCardMoveSound();
      lastSource = nextMove.from;
      if (!findNextAutoMove(current)) {
        this.flyingCard = null;
        this.draw();
      }
    }
  }

  private async animateAutoMove(current: State, move: AutoMove, fallbackSource: SourceLocation): Promise<void> {
    const from = getSourceRect(current, this.geometry, move.from) ?? getSourceRect(current, this.geometry, fallbackSource);
    const to = getFoundationRect(this.geometry, move.foundation, move.card);
    const durationMs = prefersReducedMotion() ? REDUCED_MOTION_MS : ANIMATION_MS;
    if (!from) {
      await delay(durationMs);
      return;
    }
    const initial: FlyingCard = { card: move.card, from, to, hiddenSource: move.from, progress: 0 };
    this.flyingCard = initial;
    this.draw();
    await this.animate(durationMs, (progress) => {
      this.flyingCard = { ...initial, progress: easeInOutCubic(progress) };
      this.draw();
    });
  }

  private async animateStackMove(current: State, move: StackMove): Promise<void> {
    const fromColumn = current.tableau[move.fromIndex];
    const destinationColumn = current.tableau[move.toIndex];
    const sourceStartIndex = fromColumn.length - move.cards.length;
    const destinationStartIndex = destinationColumn.length;
    const from = move.cards.map((_, index) => getColumnCardRect(this.geometry, move.fromIndex, fromColumn.length - 1 - index));
    const to = move.cards.map((_, index) => getColumnCardRect(this.geometry, move.toIndex, destinationStartIndex + index));
    const durationMs = prefersReducedMotion() ? REDUCED_MOTION_MS : ANIMATION_MS;
    const initial: FlyingStack = {
      cards: move.cards,
      from,
      to,
      hiddenSource: { columnIndex: move.fromIndex, startIndex: sourceStartIndex, count: move.cards.length },
      progress: 0,
    };
    this.flyingStack = initial;
    this.draw();
    await this.animate(durationMs + STACK_STAGGER_CAP_MS, (progress) => {
      this.flyingStack = { ...initial, progress: easeInOutCubic(progress) };
      this.draw();
    });
  }

  private animate(durationMs: number, onFrame: (progress: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now: number): void => {
        if (this.destroyed) {
          resolve();
          return;
        }
        const progress = Math.min(1, (now - start) / durationMs);
        onFrame(progress);
        if (progress < 1) this.animationFrame = requestAnimationFrame(frame);
        else resolve();
      };
      this.animationFrame = requestAnimationFrame(frame);
    });
  }

  private draw(): void {
    clearGroup(this.boardGroup);
    this.addPlane(this.boardGroup, this.getTexture("background", createBackgroundTexture), this.geometry.board, 0, "background");
    const hiddenKey = this.drag ? sourceKey(this.drag.source) : this.flyingCard ? sourceKey(this.flyingCard.hiddenSource) : null;
    const validDrops = new Set(this.drag?.validMoves.map((move) => dropKey({ type: move.toType, index: move.toIndex } as DropLocation)) ?? []);
    this.drawMajorFoundationStack(this.geometry.majorLow, "low", this.state.majorLow);
    this.drawMajorFoundationStack(this.geometry.majorHigh, "high", this.state.majorHigh);
    this.geometry.minorFoundations.forEach((rect, index) => this.addCard(`${SUITS[index].code}${this.state.minor[index]}`, rect, 20));
    this.drawPark(hiddenKey, validDrops);
    this.drawTableau(hiddenKey, this.flyingStack?.hiddenSource ?? null, validDrops);
    this.drawControls();

    clearGroup(this.overlayGroup);
    if (this.flyingStack) this.drawFlyingStack(this.flyingStack);
    if (this.flyingCard) this.drawFlyingCard(this.flyingCard);
    if (this.drag) this.addCard(this.drag.card, getDragCardRect(this.geometry, this.drag), 120, true);
    this.render();
  }

  private drawMajorFoundationStack(rect: VisualRect, direction: "low" | "high", rank: number): void {
    const isEmpty = direction === "low" ? rank < 0 : rank > 21;
    if (isEmpty) {
      this.addSlot(rect, 10);
      return;
    }
    const count = direction === "low" ? rank + 1 : 22 - rank;
    const visibleBacks = majorFoundationVisibleBacks(count);
    for (let i = 0; i < visibleBacks; i++) {
      const x = direction === "low" ? rect.x + i * MAJOR_FOUNDATION_BACK_OFFSET : rect.x - i * MAJOR_FOUNDATION_BACK_OFFSET;
      const visibleRank = direction === "low" ? rank - visibleBacks + i : rank + visibleBacks - i;
      this.addCard(`M${visibleRank}`, { ...rect, x, width: this.geometry.card.width, height: this.geometry.card.height }, 15 + i);
    }
    this.addCard(`M${rank}`, { ...rect, x: getMajorFoundationTopX(rect, direction, count) }, 25);
  }

  private drawPark(hiddenKey: string | null, validDrops: Set<string>): void {
    const isValidDrop = validDrops.has(dropKey({ type: "park", index: 0 }));
    if (isValidDrop) {
      this.addHighlight(this.geometry.park, 30);
      if (!this.state.park) this.addSlot(this.geometry.park, 25);
    }
    if (this.state.park && hiddenKey !== sourceKey({ type: "park", index: 0 })) this.addCard(this.state.park, this.geometry.park, 35);
  }

  private drawTableau(
    hiddenKey: string | null,
    hiddenStack: FlyingStack["hiddenSource"] | null,
    validDrops: Set<string>,
  ): void {
    this.state.tableau.forEach((column, index) => {
      const columnRect = this.geometry.columns[index];
      const isValidDrop = validDrops.has(dropKey({ type: "column", index }));
      this.addSlot({ ...columnRect, height: this.geometry.card.height }, 10, "#2a1a12");
      if (column.length === 0) {
        if (isValidDrop) this.addHighlight({ ...columnRect, height: this.geometry.card.height }, 35);
        return;
      }
      column.forEach((card, cardIndex) => {
        const topCardHidden = cardIndex === column.length - 1 && hiddenKey === sourceKey({ type: "column", index });
        const stackCardHidden =
          hiddenStack &&
          hiddenStack.columnIndex === index &&
          cardIndex >= hiddenStack.startIndex &&
          cardIndex < hiddenStack.startIndex + hiddenStack.count;
        if (!topCardHidden && !stackCardHidden) this.addCard(card, getColumnCardRect(this.geometry, index, cardIndex), 20 + cardIndex * 0.01);
      });
      if (isValidDrop) this.addHighlight(getColumnCardRect(this.geometry, index, column.length - 1), 40);
    });
  }

  private drawFlyingCard(flying: FlyingCard): void {
    const x = lerp(flying.from.x, flying.to.x, flying.progress);
    const y = lerp(flying.from.y, flying.to.y, flying.progress);
    const rotated = flying.to.rotated && flying.progress > 0.5;
    this.addCard(flying.card, {
      x,
      y,
      width: rotated ? this.geometry.card.height : this.geometry.card.width,
      height: rotated ? this.geometry.card.width : this.geometry.card.height,
      rotated,
    }, 140, true, this.overlayGroup);
  }

  private drawFlyingStack(flying: FlyingStack): void {
    const count = Math.max(1, flying.cards.length);
    flying.cards.forEach((card, index) => {
      const stagger = count === 1 ? 0 : (index / (count - 1)) * (STACK_STAGGER_CAP_MS / (ANIMATION_MS + STACK_STAGGER_CAP_MS));
      const progress = Math.max(0, Math.min(1, (flying.progress - stagger) / (1 - stagger)));
      const from = flying.from[index];
      const to = flying.to[index];
      this.addCard(card, {
        x: lerp(from.x, to.x, progress),
        y: lerp(from.y, to.y, progress),
        width: this.geometry.card.width,
        height: this.geometry.card.height,
      }, 130 + index, true, this.overlayGroup);
    });
  }

  private drawControls(): void {
    const layout = getControlLayout(this.strategies, this.showStrategySelector, this.strategyMenuOpen, this.selectedStrategy);
    for (const surface of layout.surfaces) {
      const selected = isControlActionSelected(surface.action, this.gameMode, this.soundEnabled, this.selectedStrategy);
      const disabled = surface.disabled || this.isControlActionDisabled(surface.action);
      const texture = this.getTexture(controlTextureKey(surface, selected, disabled), () =>
        createControlTexture(surface, selected, disabled),
      );
      this.addPlane(this.boardGroup, texture, surface, controlZ(surface.action), "control");
    }
  }

  private addCard(card: string, rect: VisualRect, z: number, floating = false, group = this.boardGroup): void {
    const texture = this.getTexture(`card:${card}:${floating ? "floating" : "flat"}`, () => createCardTexture(card, floating));
    const displayRect = getCardDisplayRect(normalizeCardRect(rect, this.geometry.card), floating);
    const mesh = this.addPlane(group, texture, displayRect, z, `card-${card}`);
    if (rect.rotated) mesh.rotation.z = Math.PI / 2;
  }

  private addSlot(rect: VisualRect, z: number, fill?: string): void {
    const key = `slot:${rect.rotated ? "rotated" : "normal"}:${fill ?? "default"}`;
    const size = rect.rotated ? { width: rect.height, height: rect.width } : rect;
    const texture = this.getTexture(key, () => createSlotTexture(size.width, size.height, fill));
    const mesh = this.addPlane(this.boardGroup, texture, normalizeRotatedRect(rect), z, "slot");
    if (rect.rotated) mesh.rotation.z = Math.PI / 2;
  }

  private addHighlight(rect: VisualRect, z: number): void {
    const texture = this.getTexture(`highlight:${rect.width}:${rect.height}`, () => createHighlightTexture(rect.width, rect.height));
    this.addPlane(this.boardGroup, texture, { x: rect.x - 8, y: rect.y - 8, width: rect.width + 16, height: rect.height + 16 }, z, "highlight");
  }

  private addPlane(group: THREE.Group, texture: THREE.Texture, rect: Rect, z: number, name: string): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    this.materials.push(material);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rect.width, rect.height), material);
    mesh.name = name;
    mesh.position.set(rect.x + rect.width / 2, BOARD_HEIGHT - rect.y - rect.height / 2, z);
    group.add(mesh);
    return mesh;
  }

  private getTexture(key: string, make: () => HTMLCanvasElement): THREE.Texture {
    const existing = this.textureCache.get(key);
    if (existing) return existing;
    const texture = new THREE.CanvasTexture(make());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    this.textureCache.set(key, texture);
    return texture;
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private toBoardPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * BOARD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * BOARD_HEIGHT,
    };
  }

  private playCardMoveSound(count = 1): void {
    if (!this.soundEnabled) return;
    const audio = getAudioContext(this.audioContext);
    if (!audio) return;
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    for (let index = 0; index < count; index++) {
      playCardTick(audio, now + (index * CARD_MOVE_SOUND_INTERVAL_MS) / 1000, index);
    }
  }
}

function clearGroup(group: THREE.Group): void {
  while (group.children.length > 0) {
    const child = group.children.pop();
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
      else child.material.dispose();
    }
  }
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
  const minorFoundations = [1900, 2128, 2356, 2584].map((x) => ({ x, y: 110, width: card.width, height: card.height }));
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

function getControlLayout(
  strategies: string[],
  showStrategySelector: boolean,
  strategyMenuOpen: boolean,
  selectedStrategy: string,
): ControlLayout {
  const x = 1120;
  const y = 112;
  const height = 72;
  const gap = 16;
  const rowGap = 24;
  const surfaces: ControlSurface[] = [
    { x, y, width: 190, height, action: { type: "new-deal" } },
    { x: x + 190 + gap, y, width: 145, height, action: { type: "undo" } },
  ];
  const strategyRect = { x: x + 190 + gap + 145 + gap, y, width: 349, height };
  if (showStrategySelector) surfaces.push({ ...strategyRect, action: { type: "strategy-toggle", strategy: selectedStrategy } });

  const secondY = y + height + rowGap;
  surfaces.push(
    { x, y: secondY, width: 210, height, action: { type: "game-mode", mode: "single-card" } },
    { x: x + 210 + 10, y: secondY, width: 210, height, action: { type: "game-mode", mode: "entire-stack" } },
    { x: x + 210 + 10 + 210 + 24, y: secondY, width: 130, height, action: { type: "sound", enabled: true } },
    { x: x + 210 + 10 + 210 + 24 + 130 + 10, y: secondY, width: 130, height, action: { type: "sound", enabled: false } },
  );

  if (!showStrategySelector || !strategyMenuOpen) return { surfaces, menuRect: null };

  const optionHeight = 38;
  const menuRect = {
    x: strategyRect.x,
    y: strategyRect.y + strategyRect.height + 8,
    width: strategyRect.width,
    height: strategies.length * optionHeight,
  };
  strategies.forEach((strategy, index) => {
    surfaces.push({
      x: menuRect.x,
      y: menuRect.y + index * optionHeight,
      width: menuRect.width,
      height: optionHeight,
      action: { type: "strategy-select", strategy },
    });
  });
  return { surfaces, menuRect };
}

function findControlAtPoint(layout: ControlLayout, point: { x: number; y: number }): ControlSurface | null {
  for (let index = layout.surfaces.length - 1; index >= 0; index--) {
    const surface = layout.surfaces[index];
    if (contains(surface, point)) return surface;
  }
  return null;
}

function isControlActionSelected(
  action: ControlAction,
  gameMode: GameMode,
  soundEnabled: boolean,
  selectedStrategy: string,
): boolean {
  if (action.type === "game-mode") return action.mode === gameMode;
  if (action.type === "sound") return action.enabled === soundEnabled;
  if (action.type === "strategy-select") return action.strategy === selectedStrategy;
  return false;
}

function controlZ(action: ControlAction): number {
  return action.type === "strategy-select" ? 105 : 80;
}

function controlTextureKey(surface: ControlSurface, selected: boolean, disabled: boolean): string {
  return [
    "control",
    surface.width,
    surface.height,
    actionLabel(surface.action),
    selected ? "selected" : "idle",
    disabled ? "disabled" : "enabled",
  ].join(":");
}

function createControlTexture(surface: ControlSurface, selected: boolean, disabled: boolean): HTMLCanvasElement {
  const canvas = createCanvas(surface.width, surface.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const isOption = surface.action.type === "strategy-select";
  const fill = selected ? "#7b2f1d" : isOption ? "#321813" : "#3b0b14";
  const stroke = selected ? "#ffe0a3" : "#c18443";
  const textColor = disabled ? "rgba(255, 216, 155, 0.42)" : selected ? "#fff0c3" : "#ffd99b";
  ctx.globalAlpha = disabled ? 0.56 : 1;
  drawRoundedRect(ctx, 1, 1, surface.width - 2, surface.height - 2, 6, fill, stroke, 4);
  ctx.globalAlpha = 1;
  if (surface.action.type === "strategy-toggle") {
    drawControlCaption(ctx, "Deal", 18, 23, disabled);
    drawFitText(ctx, actionLabel(surface.action), 18, 53, surface.width - 44, 24, textColor, 700);
    ctx.fillStyle = textColor;
    ctx.font = "700 24px Georgia";
    ctx.textAlign = "right";
    ctx.fillText("v", surface.width - 18, 48);
    ctx.textAlign = "start";
    return canvas;
  }
  if (surface.action.type === "game-mode") drawControlCaption(ctx, "Move", 18, 23, disabled);
  if (surface.action.type === "sound") drawControlCaption(ctx, "Sound", 18, 23, disabled);
  const baseline = surface.action.type === "strategy-select" ? Math.round(surface.height / 2 + 9) : 53;
  const maxSize = surface.action.type === "strategy-select" ? 20 : 28;
  drawFitText(ctx, actionLabel(surface.action), 18, baseline, surface.width - 36, maxSize, textColor, 800);
  return canvas;
}

function actionLabel(action: ControlAction): string {
  switch (action.type) {
    case "new-deal":
      return "New Deal";
    case "undo":
      return "Undo";
    case "game-mode":
      return action.mode === "single-card" ? "Single" : "Stack";
    case "sound":
      return action.enabled ? "On" : "Off";
    case "strategy-toggle":
      return action.strategy;
    case "strategy-select":
      return action.strategy;
  }
}

function drawControlCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  disabled: boolean,
): void {
  ctx.fillStyle = disabled ? "rgba(242, 195, 137, 0.42)" : "#f2c389";
  ctx.font = "700 16px Georgia";
  ctx.fillText(text.toUpperCase(), x, y);
}

function drawFitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  maxWidth: number,
  maxSize: number,
  color: string,
  weight: number,
): void {
  let size = maxSize;
  ctx.font = `${weight} ${size}px Georgia`;
  while (size > 12 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${weight} ${size}px Georgia`;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, baseline);
}

function getColumnCardRect(geometry: BoardGeometry, columnIndex: number, cardIndex: number): VisualRect {
  const column = geometry.columns[columnIndex];
  return { x: column.x, y: column.y + cardIndex * geometry.stackOffset, width: geometry.card.width, height: geometry.card.height };
}

function getEmptyColumnDropRect(geometry: BoardGeometry, columnIndex: number): VisualRect {
  const column = geometry.columns[columnIndex];
  return { x: column.x, y: column.y, width: geometry.card.width, height: geometry.card.height };
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

function normalizeCardRect(rect: VisualRect, card: { width: number; height: number }): VisualRect {
  if (!rect.rotated) return rect;
  return {
    x: rect.x + (rect.width - card.width) / 2,
    y: rect.y + (rect.height - card.height) / 2,
    width: card.width,
    height: card.height,
    rotated: true,
  };
}

function normalizeRotatedRect(rect: VisualRect): VisualRect {
  if (!rect.rotated) return rect;
  return {
    ...rect,
    x: rect.x + (rect.width - rect.height) / 2,
    y: rect.y + (rect.height - rect.width) / 2,
    width: rect.height,
    height: rect.width,
  };
}

function getCardDisplayRect(rect: VisualRect, floating: boolean): VisualRect {
  if (!floating) return rect;
  const shadow = 44;
  return {
    ...rect,
    x: rect.x - shadow,
    y: rect.y - shadow,
    width: rect.width + shadow * 2,
    height: rect.height + shadow * 2,
  };
}

function getMajorFoundationTopX(rect: VisualRect, direction: "low" | "high", count: number): number {
  const visibleBacks = majorFoundationVisibleBacks(count);
  return direction === "low" ? rect.x + visibleBacks * MAJOR_FOUNDATION_BACK_OFFSET : rect.x - visibleBacks * MAJOR_FOUNDATION_BACK_OFFSET;
}

function majorFoundationVisibleBacks(count: number): number {
  return Math.min(Math.max(0, count - 1), MAJOR_FOUNDATION_MAX_BACKS);
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

function sourceKey(source: SourceLocation): string {
  return `${source.type}:${source.index}`;
}

function dropKey(drop: DropLocation): string {
  return `${drop.type}:${drop.index}`;
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

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  return canvas;
}

function createBackgroundTexture(): HTMLCanvasElement {
  const canvas = createCanvas(BOARD_WIDTH, BOARD_HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const separatorY = 520;
  ctx.fillStyle = "#20110d";
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.fillStyle = "#6f211a";
  ctx.fillRect(0, 0, BOARD_WIDTH, 520);
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
  for (let x = 115; x < BOARD_WIDTH - 80; x += 72) drawTriangle(ctx, x, 28, 26);
  return canvas;
}

function createCardTexture(card: string, floating: boolean): HTMLCanvasElement {
  const shadow = floating ? 44 : 0;
  const canvas = createCanvas(198 + shadow * 2, 340 + shadow * 2);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  drawCardFace(ctx, card, shadow, shadow, 198, 340, floating);
  return canvas;
}

function createSlotTexture(width: number, height: number, fill?: string): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.setLineDash([14, 14]);
  drawRoundedRect(ctx, 0, 0, width, height, 4, fill ?? "rgba(40,20,18,0.36)", "rgba(220,151,78,0.8)", 4);
  ctx.setLineDash([]);
  return canvas;
}

function createHighlightTexture(width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width + 16, height + 16);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.strokeStyle = "#fff0a2";
  ctx.lineWidth = 8;
  ctx.fillStyle = "rgba(255,218,99,0.12)";
  ctx.fillRect(0, 0, width + 16, height + 16);
  ctx.strokeRect(4, 4, width + 8, height + 8);
  return canvas;
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

function getInitialStrategy(strategies: string[], showStrategySelector: boolean): string {
  if (!showStrategySelector) return DEFAULT_GENERATION_STRATEGY;
  const storedStrategy = readLocalStorage(SELECTED_STRATEGY_STORAGE_KEY);
  return storedStrategy && strategies.includes(storedStrategy) ? storedStrategy : DEFAULT_GENERATION_STRATEGY;
}

function shouldShowStrategySelector(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_SHOW_STRATEGY_SELECTOR === "true";
}

function getInitialGameMode(): GameMode {
  const storedMode = readLocalStorage(GAME_MODE_STORAGE_KEY);
  return storedMode === "single-card" || storedMode === "entire-stack" ? storedMode : "single-card";
}

function getInitialSoundEnabled(): boolean {
  return readLocalStorage(SOUND_ENABLED_STORAGE_KEY) !== "false";
}

function getAudioContext(ref: { current: AudioContext | null }): AudioContext | null {
  if (ref.current) return ref.current;
  try {
    ref.current = new AudioContext();
    return ref.current;
  } catch {
    return null;
  }
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

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeInOutCubic(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
