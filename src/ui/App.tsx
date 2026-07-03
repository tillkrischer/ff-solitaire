import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useMemo, useRef, useState } from "react";
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

type FlyingCard = {
  card: string;
  from: DOMRect;
  to: DOMRect;
  sourceKey: string;
  durationMs: number;
};

type CardDimensions = {
  width: number;
  height: number;
};

type DragOverlayDimensions = {
  source: CardDimensions;
  vertical: CardDimensions;
  horizontal: CardDimensions;
};

type RelativePoint = {
  x: number;
  y: number;
};

const AUTO_MOVE_MS = 360;
const REDUCED_MOTION_MS = 30;
const PARK_CARD_WIDTH_RATIO = 1.2;
const PARK_CARD_HEIGHT_RATIO = 0.45;
const SUITS = [
  { name: "Cups", code: "C", symbol: "◆", color: "cups" },
  { name: "Swords", code: "S", symbol: "†", color: "swords" },
  { name: "Stars", code: "A", symbol: "✦", color: "stars" },
  { name: "Thorns", code: "T", symbol: "♣", color: "thorns" },
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

export function App(): JSX.Element {
  const strategies = useMemo(() => listGenerationStrategies(), []);
  const [selectedStrategy, setSelectedStrategy] = useState(strategies[0] ?? "one-move-constructive");
  const [deal, setDeal] = useState<GenerateDealResult>(() => generateDeal({ strategy: strategies[0] }));
  const [state, setState] = useState<State>(() => parseBoard(deal.board));
  const [activeSource, setActiveSource] = useState<SourceLocation | null>(null);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [activeCardDimensions, setActiveCardDimensions] = useState<DragOverlayDimensions | null>(null);
  const [activePointerRatio, setActivePointerRatio] = useState<RelativePoint>({ x: 0.5, y: 0.5 });
  const [isDragAboveTableau, setIsDragAboveTableau] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [flyingCard, setFlyingCard] = useState<FlyingCard | null>(null);
  const tableauFieldRef = useRef<HTMLElement | null>(null);
  const sourceRefs = useRef(new Map<string, HTMLElement>());
  const foundationRefs = useRef(new Map<FoundationTarget, HTMLElement>());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const validMoves = useMemo(() => {
    if (!activeSource || isResolving) return [];
    return getValidMoves(state).filter(
      (move) => move.fromType === activeSource.type && move.fromIndex === activeSource.index,
    );
  }, [activeSource, isResolving, state]);

  const validDropIds = useMemo(() => new Set(validMoves.map((move) => dropId(move.toType, move.toIndex))), [validMoves]);

  const registerSource = useCallback((key: string, element: HTMLElement | null) => {
    if (element) sourceRefs.current.set(key, element);
    else sourceRefs.current.delete(key);
  }, []);

  const registerFoundation = useCallback((key: FoundationTarget, element: HTMLElement | null) => {
    if (element) foundationRefs.current.set(key, element);
    else foundationRefs.current.delete(key);
  }, []);

  function startNewDeal(): void {
    const nextDeal = generateDeal({ strategy: selectedStrategy, seed: Date.now() });
    setDeal(nextDeal);
    setState(parseBoard(nextDeal.board));
    setActiveSource(null);
    setActiveCard(null);
    setActiveCardDimensions(null);
    setActivePointerRatio({ x: 0.5, y: 0.5 });
    setIsDragAboveTableau(false);
    setFlyingCard(null);
    setIsResolving(false);
  }

  function handleDragStart(event: DragStartEvent): void {
    if (isResolving) return;
    const source = parseCardId(String(event.active.id));
    if (!source) return;
    const card = getCardAtSource(state, source);
    if (!card) return;
    setActiveSource(source);
    setActiveCard(card);
    setActiveCardDimensions(getDragOverlayDimensions(source));
    setActivePointerRatio(getPointerRatio(source, event.activatorEvent));
    setIsDragAboveTableau(isSourceAboveTableau(source));
  }

  function handleDragMove(event: DragMoveEvent): void {
    const source = activeSource;
    const tableauElement = tableauFieldRef.current;
    if (!source || !tableauElement) return;

    const sourceElement = sourceRefs.current.get(sourceKey(source));
    if (!sourceElement) return;

    const draggedTop = sourceElement.getBoundingClientRect().top + event.delta.y;
    const tableauTop = tableauElement.getBoundingClientRect().top;
    setIsDragAboveTableau(draggedTop < tableauTop);
  }

  function isSourceAboveTableau(source: SourceLocation): boolean {
    const sourceElement = sourceRefs.current.get(sourceKey(source));
    const tableauElement = tableauFieldRef.current;
    if (!sourceElement || !tableauElement) return false;
    return sourceElement.getBoundingClientRect().top < tableauElement.getBoundingClientRect().top;
  }

  function getDragOverlayDimensions(source: SourceLocation): DragOverlayDimensions | null {
    const sourceElement = sourceRefs.current.get(sourceKey(source));
    if (!sourceElement) return null;

    const rect = sourceElement.getBoundingClientRect();
    const sourceDimensions = {
      width: rect.width,
      height: rect.height,
    };

    if (source.type === "park") {
      return {
        source: sourceDimensions,
        vertical: {
          width: rect.width / PARK_CARD_WIDTH_RATIO,
          height: rect.height / PARK_CARD_HEIGHT_RATIO,
        },
        horizontal: {
          width: rect.width,
          height: rect.height,
        },
      };
    }

    return {
      source: sourceDimensions,
      vertical: {
        width: rect.width,
        height: rect.height,
      },
      horizontal: {
        width: rect.width * PARK_CARD_WIDTH_RATIO,
        height: rect.height * PARK_CARD_HEIGHT_RATIO,
      },
    };
  }

  function getPointerRatio(source: SourceLocation, event: Event): RelativePoint {
    const sourceElement = sourceRefs.current.get(sourceKey(source));
    if (!sourceElement || !("clientX" in event) || !("clientY" in event)) {
      return { x: 0.5, y: 0.5 };
    }

    const rect = sourceElement.getBoundingClientRect();
    return {
      x: clampRatio((Number(event.clientX) - rect.left) / rect.width),
      y: clampRatio((Number(event.clientY) - rect.top) / rect.height),
    };
  }

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    const source = activeSource;
    const overId = event.over?.id ? String(event.over.id) : null;
    setActiveSource(null);
    setActiveCard(null);
    setActiveCardDimensions(null);
    setActivePointerRatio({ x: 0.5, y: 0.5 });
    setIsDragAboveTableau(false);
    if (!source || !overId) return;
    const destination = parseDropId(overId);
    if (!destination) return;
    const move = validMoves.find((candidate) => candidate.toType === destination.type && candidate.toIndex === destination.index);
    if (!move) return;

    const manualState = applyManualOnly(state, move);
    setState(manualState);
    setIsResolving(true);
    await waitForPaint();
    await resolveAutomaticMoves(manualState);
    setIsResolving(false);
  }

  async function resolveAutomaticMoves(startState: State): Promise<void> {
    let current = startState;
    while (true) {
      const nextMove = findNextAutoMove(current);
      if (!nextMove) break;
      await animateAutoMove(nextMove);
      current = applySingleAutoMove(current, nextMove);
      setState(current);
      await waitForPaint();
    }
  }

  async function animateAutoMove(move: AutoMove): Promise<void> {
    const sourceElement = sourceRefs.current.get(sourceKey(move.from));
    const foundationElement = foundationRefs.current.get(move.foundation);
    const durationMs = prefersReducedMotion() ? REDUCED_MOTION_MS : AUTO_MOVE_MS;
    if (!sourceElement || !foundationElement) {
      await delay(durationMs);
      return;
    }

    setFlyingCard({
      card: move.card,
      from: sourceElement.getBoundingClientRect(),
      to: foundationElement.getBoundingClientRect(),
      sourceKey: sourceKey(move.from),
      durationMs,
    });
    await delay(durationMs);
    setFlyingCard(null);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveSource(null);
        setActiveCard(null);
        setActiveCardDimensions(null);
        setActivePointerRatio({ x: 0.5, y: 0.5 });
        setIsDragAboveTableau(false);
      }}
    >
      <main className="min-h-screen overflow-hidden bg-black p-[clamp(8px,1vw,16px)] text-amber-50">
        <div className="game-board mx-auto">
          <aside className="side-rail left-rail">
            <div className="wins-panel">
              <span>WINS</span>
              <strong>0</strong>
            </div>
            <Vine />
          </aside>
          <aside className="side-rail right-rail">
            <button className="round-close" type="button" aria-label="Close">
              X
            </button>
            <Vine />
          </aside>

          <section className="top-band">
            <Controls
              strategies={strategies}
              selectedStrategy={selectedStrategy}
              deal={deal}
              disabled={isResolving}
              won={isGoalState(state)}
              onSelect={setSelectedStrategy}
              onNewDeal={startNewDeal}
            />
            <MajorFoundation
              label="Low Major"
              topRank={state.majorLow}
              target="major-low"
              registerFoundation={registerFoundation}
            />
            <div className="oracle" aria-hidden="true">
              <span>?</span>
            </div>
            <MajorFoundation
              label="High Major"
              topRank={state.majorHigh}
              target="major-high"
              registerFoundation={registerFoundation}
            />
            <section className="minor-zone" aria-label="Minor foundations and park">
              <ParkSlot
                card={state.park}
                disabled={isResolving}
                valid={validDropIds.has(dropId("park", 0))}
                registerSource={registerSource}
                hiddenSourceKey={flyingCard?.sourceKey}
              />
              <div className="minor-foundations">
                {SUITS.map((suit, index) => (
                  <MinorFoundation
                    key={suit.code}
                    suitIndex={index}
                    rank={state.minor[index]}
                    registerFoundation={registerFoundation}
                  />
                ))}
              </div>
            </section>
          </section>

          <section ref={tableauFieldRef} className="tableau-field" aria-label="Tableau">
            {state.tableau.map((column, index) => (
              <TableauColumn
                key={index}
                cards={column}
                index={index}
                disabled={isResolving}
                valid={validDropIds.has(dropId("column", index))}
                registerSource={registerSource}
                hiddenSourceKey={flyingCard?.sourceKey}
              />
            ))}
          </section>
        </div>
        {flyingCard ? <FlyingCardLayer flyingCard={flyingCard} /> : null}
      </main>
      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <OverlayCard
            card={activeCard}
            horizontal={isDragAboveTableau}
            dimensions={activeCardDimensions}
            pointerRatio={activePointerRatio}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Controls(props: {
  strategies: string[];
  selectedStrategy: string;
  deal: GenerateDealResult;
  disabled: boolean;
  won: boolean;
  onSelect: (strategy: string) => void;
  onNewDeal: () => void;
}): JSX.Element {
  return (
    <div className="controls">
      <label>
        <span>Deal strategy</span>
        <select value={props.selectedStrategy} disabled={props.disabled} onChange={(event) => props.onSelect(event.target.value)}>
          {props.strategies.map((strategy) => (
            <option key={strategy} value={strategy}>
              {strategy}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={props.disabled} onClick={props.onNewDeal}>
        New Deal
      </button>
      <dl>
        <div>
          <dt>Seed</dt>
          <dd>{props.deal.seed}</dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd>{props.deal.attempts}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{props.won ? "Won" : props.disabled ? "Resolving" : "Playing"}</dd>
        </div>
      </dl>
    </div>
  );
}

function TableauColumn(props: {
  cards: string[];
  index: number;
  disabled: boolean;
  valid: boolean;
  hiddenSourceKey?: string;
  registerSource: (key: string, element: HTMLElement | null) => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: dropId("column", props.index),
    disabled: props.disabled,
  });

  return (
    <div ref={setNodeRef} className={`tableau-column ${props.valid ? "valid-target" : ""} ${isOver && props.valid ? "target-over" : ""}`}>
      <div className="column-marker">{props.index + 1}</div>
      <div className="column-stack">
        {props.cards.length === 0 ? <div className="empty-column">Empty</div> : null}
        {props.cards.map((card, cardIndex) => {
          const isTop = cardIndex === props.cards.length - 1;
          const key = sourceKey({ type: "column", index: props.index });
          return (
            <PlayableCard
              key={`${card}-${cardIndex}`}
              card={card}
              index={cardIndex}
              source={{ type: "column", index: props.index }}
              draggable={isTop && !props.disabled}
              hidden={isTop && props.hiddenSourceKey === key}
              registerSource={isTop ? props.registerSource : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function ParkSlot(props: {
  card: string | null;
  disabled: boolean;
  valid: boolean;
  hiddenSourceKey?: string;
  registerSource: (key: string, element: HTMLElement | null) => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: dropId("park", 0), disabled: props.disabled });
  const key = sourceKey({ type: "park", index: 0 });
  return (
    <div ref={setNodeRef} className={`park-slot ${props.valid ? "valid-target" : ""} ${isOver && props.valid ? "target-over" : ""}`}>
      <span className="slot-label">Park</span>
      {props.card ? (
        <PlayableCard
          card={props.card}
          index={0}
          source={{ type: "park", index: 0 }}
          draggable={!props.disabled}
          horizontal
          hidden={props.hiddenSourceKey === key}
          registerSource={props.registerSource}
        />
      ) : (
        <div className="park-empty">Blocks minor foundations</div>
      )}
    </div>
  );
}

function PlayableCard(props: {
  card: string;
  index: number;
  source: SourceLocation;
  draggable: boolean;
  horizontal?: boolean;
  hidden?: boolean;
  registerSource?: (key: string, element: HTMLElement | null) => void;
}): JSX.Element {
  const key = sourceKey(props.source);

  if (!props.draggable) {
    return (
      <CardShell
        {...props}
        nodeRef={props.registerSource ? (element) => props.registerSource?.(key, element) : undefined}
      />
    );
  }

  const id = cardId(props.source.type, props.source.index);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
  });

  return (
    <CardShell
      {...props}
      hidden={props.hidden || isDragging}
      nodeRef={(element) => {
        setNodeRef(element);
        if (props.registerSource) props.registerSource(key, element);
      }}
      listeners={listeners}
      attributes={attributes}
    />
  );
}

function CardShell(props: {
  card: string;
  index: number;
  source: SourceLocation;
  draggable: boolean;
  horizontal?: boolean;
  hidden?: boolean;
  nodeRef?: (element: HTMLElement | null) => void;
  listeners?: React.HTMLAttributes<HTMLDivElement>;
  attributes?: React.HTMLAttributes<HTMLDivElement>;
}): JSX.Element {
  const style = {
    top: props.horizontal ? undefined : `calc(${props.index} * var(--stack-offset))`,
    opacity: props.hidden ? 0 : 1,
    zIndex: props.index + 1,
  };

  return (
    <div
      ref={props.nodeRef}
      className={`playable-card ${props.horizontal ? "horizontal-card" : ""} ${props.draggable ? "draggable" : ""}`}
      style={style}
      {...props.listeners}
      {...props.attributes}
    >
      <Card card={props.card} />
    </div>
  );
}

function Card({ card, floating = false }: { card: string; floating?: boolean }): JSX.Element {
  const decoded = decodeCard(card);
  if (decoded.kind === "major") {
    const name = MAJOR_NAMES[decoded.rank] ?? "Major";
    return (
      <article className={`card major-card ${floating ? "floating" : ""}`}>
        <div className="card-corner">{decoded.rank}</div>
        <div className="major-sigil">{decoded.rank}</div>
        <div className="card-name">{name}</div>
      </article>
    );
  }

  const suit = SUITS[decoded.suitIndex];
  return (
    <article className={`card minor-card suit-${suit.color} ${floating ? "floating" : ""}`}>
      <div className="card-corner">
        {rankText(decoded.rank)}
        <span>{suit.symbol}</span>
      </div>
      <div className="pip-grid" aria-hidden="true">
        {Array.from({ length: Math.min(decoded.rank, 10) }).map((_, index) => (
          <span key={index}>{suit.symbol}</span>
        ))}
      </div>
      <div className="card-name">
        {rankText(decoded.rank)} {suit.name}
      </div>
    </article>
  );
}

function OverlayCard({
  card,
  horizontal,
  dimensions,
  pointerRatio,
}: {
  card: string;
  horizontal: boolean;
  dimensions: DragOverlayDimensions | null;
  pointerRatio: RelativePoint;
}): JSX.Element {
  const activeDimensions = horizontal ? dimensions?.horizontal : dimensions?.vertical;
  const style = activeDimensions && dimensions
    ? ({
        width: `${activeDimensions.width}px`,
        height: `${activeDimensions.height}px`,
        transform: `translate(${dimensions.source.width * pointerRatio.x - activeDimensions.width * pointerRatio.x}px, ${
          dimensions.source.height * pointerRatio.y - activeDimensions.height * pointerRatio.y
        }px)`,
      } satisfies React.CSSProperties)
    : undefined;

  return (
    <div className={`drag-overlay-card ${horizontal ? "horizontal-card" : ""}`} style={style}>
      <Card card={card} floating />
    </div>
  );
}

function MajorFoundation(props: {
  label: string;
  topRank: number;
  target: FoundationTarget;
  registerFoundation: (key: FoundationTarget, element: HTMLElement | null) => void;
}): JSX.Element {
  const visibleRank = props.target === "major-low" ? props.topRank : props.topRank;
  const isEmpty = props.target === "major-low" ? props.topRank < 0 : props.topRank > 21;
  return (
    <div ref={(element) => props.registerFoundation(props.target, element)} className="foundation major-foundation">
      <span>{props.label}</span>
      {isEmpty ? <div className="foundation-empty">Major</div> : <Card card={`M${visibleRank}`} />}
    </div>
  );
}

function MinorFoundation(props: {
  suitIndex: number;
  rank: number;
  registerFoundation: (key: FoundationTarget, element: HTMLElement | null) => void;
}): JSX.Element {
  const suit = SUITS[props.suitIndex];
  return (
    <div ref={(element) => props.registerFoundation(`minor-${props.suitIndex}`, element)} className="foundation minor-foundation">
      <span>{suit.name}</span>
      <Card card={`${suit.code}${props.rank}`} />
    </div>
  );
}

function FlyingCardLayer({ flyingCard }: { flyingCard: FlyingCard }): JSX.Element {
  const dx = flyingCard.to.left + flyingCard.to.width / 2 - (flyingCard.from.left + flyingCard.from.width / 2);
  const dy = flyingCard.to.top + flyingCard.to.height / 2 - (flyingCard.from.top + flyingCard.from.height / 2);
  return (
    <div
      className="flying-card"
      style={{
        left: flyingCard.from.left,
        top: flyingCard.from.top,
        width: flyingCard.from.width,
        height: flyingCard.from.height,
        "--fly-x": `${dx}px`,
        "--fly-y": `${dy}px`,
        "--fly-duration": `${flyingCard.durationMs}ms`,
      } as React.CSSProperties}
    >
      <Card card={flyingCard.card} floating />
    </div>
  );
}

function Vine(): JSX.Element {
  return (
    <div className="vine" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, index) => (
        <span key={index}>✦</span>
      ))}
    </div>
  );
}

function findNextAutoMove(state: State): AutoMove | null {
  if (state.park && canMoveToFoundation(state, state.park, true)) {
    return {
      card: state.park,
      from: { type: "park", index: 0 },
      foundation: foundationForCard(state, state.park),
    };
  }

  for (let index = 0; index < state.tableau.length; index++) {
    const card = state.tableau[index][state.tableau[index].length - 1];
    if (card && canMoveToFoundation(state, card, false)) {
      return {
        card,
        from: { type: "column", index },
        foundation: foundationForCard(state, card),
      };
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

function cardId(type: SourceLocation["type"], index: number): string {
  return `card:${type}:${index}`;
}

function dropId(type: DropLocation["type"], index: number): string {
  return `drop:${type}:${index}`;
}

function sourceKey(source: SourceLocation): string {
  return `${source.type}:${source.index}`;
}

function parseCardId(id: string): SourceLocation | null {
  const [, type, indexText] = id.split(":");
  if (type === "park") return { type, index: 0 };
  if (type === "column") return { type, index: Number(indexText) };
  return null;
}

function parseDropId(id: string): DropLocation | null {
  const [, type, indexText] = id.split(":");
  if (type === "park") return { type, index: 0 };
  if (type === "column") return { type, index: Number(indexText) };
  return null;
}

function rankText(rank: number): string {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
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
