import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import clsx from "clsx";
import { useReducer, useState, type ReactNode } from "react";
import {
  applyMove,
  canMove,
  createNewGame,
  getMovableCards,
  suits,
  undo,
  type Card,
  type CardId,
  type GameState,
  type Location,
  type MoveCommand,
  type MoveMode,
  type Suit
} from "./game";

type GameAction =
  | { type: "new-game" }
  | { type: "move"; command: MoveCommand }
  | { type: "undo" }
  | { type: "set-move-mode"; moveMode: MoveMode };

type DragData = { location: Location };
type DropData = { location: Location };

function createSeed(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "new-game":
      return createNewGame({ seed: createSeed(), moveMode: state.moveMode });
    case "move":
      return applyMove(state, action.command);
    case "undo":
      return undo(state);
    case "set-move-mode":
      return { ...state, moveMode: action.moveMode };
  }
}

export default function App() {
  const [game, dispatch] = useReducer(gameReducer, undefined, () =>
    createNewGame({ seed: "first-deal", moveMode: "entire-stack" })
  );
  const [selected, setSelected] = useState<Location | null>(null);
  const [activeDrag, setActiveDrag] = useState<{ cardIds: CardId[] } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  function tryMove(command: MoveCommand): void {
    if (canMove(game, command)) {
      dispatch({ type: "move", command });
    }
  }

  function handleLocationClick(location: Location): void {
    if (!selected) {
      if (getMovableCards(game, location).length > 0) {
        setSelected(location);
      }
      return;
    }

    setSelected(null);
    tryMove({ from: selected, to: location });
  }

  function handleDragStart(event: DragStartEvent): void {
    const location = event.active.data.current?.location as Location | undefined;
    if (!location) {
      return;
    }

    setSelected(null);
    setActiveDrag({ cardIds: getMovableCards(game, location) });
  }

  function handleDragEnd(event: DragEndEvent): void {
    const from = event.active.data.current?.location as Location | undefined;
    const to = event.over?.data.current?.location as Location | undefined;
    setActiveDrag(null);

    if (from && to) {
      tryMove({ from, to });
    }
  }

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div className="title-block">
          <p>Fortune's Foundation</p>
          <h1>Solitaire</h1>
        </div>
        <div className="toolbar-actions">
          <div className="segmented" aria-label="Tarot movement">
            <button
              type="button"
              className={game.moveMode === "entire-stack" ? "active" : undefined}
              onClick={() => dispatch({ type: "set-move-mode", moveMode: "entire-stack" })}
            >
              Stack
            </button>
            <button
              type="button"
              className={game.moveMode === "single-card" ? "active" : undefined}
              onClick={() => dispatch({ type: "set-move-mode", moveMode: "single-card" })}
            >
              Single
            </button>
          </div>
          <button type="button" className="tool-button" onClick={() => dispatch({ type: "undo" })}>
            Undo
          </button>
          <button type="button" className="tool-button primary" onClick={() => dispatch({ type: "new-game" })}>
            New Deal
          </button>
        </div>
      </header>

      <DndContext
        sensors={sensors}
        modifiers={[restrictToWindowEdges]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <section className="board" aria-label="Game board">
          <TopRow game={game} selected={selected} onLocationClick={handleLocationClick} />
          <Tableau game={game} selected={selected} onLocationClick={handleLocationClick} />
          <footer className="status-row">
            <span>Seed {game.seed}</span>
            <span>{game.history.length} moves</span>
            <span>{game.status === "won" ? "Won" : "Playing"}</span>
          </footer>
          {game.status === "won" ? <div className="win-banner">The fortune is complete.</div> : null}
        </section>

        <DragOverlay dropAnimation={null}>
          {activeDrag ? <MovingStack cardIds={activeDrag.cardIds} game={game} /> : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}

function TopRow({
  game,
  selected,
  onLocationClick
}: {
  game: GameState;
  selected: Location | null;
  onLocationClick: (location: Location) => void;
}) {
  return (
    <div className="top-row">
      <div className="major-area">
        <DropSlot location={{ type: "major-low" }} onClick={onLocationClick} className="foundation-slot">
          <FoundationCard game={game} cardId={topCard(game.foundations.majorLow)} fallback="0" />
        </DropSlot>
        <div className="major-rule">Major Arcana</div>
        <DropSlot location={{ type: "major-high" }} onClick={onLocationClick} className="foundation-slot">
          <FoundationCard game={game} cardId={topCard(game.foundations.majorHigh)} fallback="21" />
        </DropSlot>
      </div>

      <DropSlot location={{ type: "park" }} onClick={onLocationClick} className="park-slot">
        {game.parkedCard ? (
          <DraggableCard
            game={game}
            cardId={game.parkedCard}
            location={{ type: "park" }}
            selected={isSameLocation(selected, { type: "park" })}
            orientation="horizontal"
            onClick={onLocationClick}
          />
        ) : (
          <div className="empty-slot">Park</div>
        )}
      </DropSlot>

      <div className={clsx("minor-area", game.parkedCard && "blocked")}>
        {suits.map((suit) => (
          <DropSlot key={suit} location={{ type: "minor-foundation", suit }} onClick={onLocationClick} className="foundation-slot">
            <FoundationCard game={game} cardId={topCard(game.foundations.minor[suit])} fallback={suitIcon(suit)} />
          </DropSlot>
        ))}
      </div>
    </div>
  );
}

function FoundationCard({ game, cardId, fallback }: { game: GameState; cardId: CardId | undefined; fallback: string }) {
  return cardId ? <CardView card={game.cardsById[cardId]} compact /> : <div className="empty-slot">{fallback}</div>;
}

function Tableau({
  game,
  selected,
  onLocationClick
}: {
  game: GameState;
  selected: Location | null;
  onLocationClick: (location: Location) => void;
}) {
  return (
    <div className="tableau">
      {game.tableau.map((column, columnIndex) => (
        <TableauColumn
          key={columnIndex}
          game={game}
          column={column}
          columnIndex={columnIndex}
          selected={selected}
          onLocationClick={onLocationClick}
        />
      ))}
    </div>
  );
}

function TableauColumn({
  game,
  column,
  columnIndex,
  selected,
  onLocationClick
}: {
  game: GameState;
  column: CardId[];
  columnIndex: number;
  selected: Location | null;
  onLocationClick: (location: Location) => void;
}) {
  const columnLocation: Location = { type: "tableau", column: columnIndex };

  return (
    <DropSlot location={columnLocation} onClick={onLocationClick} className="tableau-column">
      {column.length === 0 ? <div className="empty-column" /> : null}
      {column.map((cardId, cardIndex) => {
        const isTop = cardIndex === column.length - 1;
        const location: Location = { type: "tableau", column: columnIndex, index: cardIndex };

        return (
          <div className="tableau-card" key={cardId}>
            {isTop ? (
              <DraggableCard
                game={game}
                cardId={cardId}
                location={{ type: "tableau", column: columnIndex }}
                selected={isSameLocation(selected, columnLocation)}
                onClick={onLocationClick}
              />
            ) : (
              <button
                type="button"
                className="card-button static-card"
                onClick={(event) => {
                  event.stopPropagation();
                  onLocationClick(location);
                }}
              >
                <CardView card={game.cardsById[cardId]} compact />
              </button>
            )}
          </div>
        );
      })}
    </DropSlot>
  );
}

function DropSlot({
  location,
  children,
  className,
  onClick
}: {
  location: Location;
  children: ReactNode;
  className?: string;
  onClick: (location: Location) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: locationId("drop", location),
    data: { location } satisfies DropData
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx("drop-slot", className, isOver && "over")}
      role="button"
      tabIndex={0}
      onClick={() => onClick(location)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(location);
        }
      }}
    >
      {children}
    </div>
  );
}

function DraggableCard({
  game,
  cardId,
  location,
  selected,
  orientation = "vertical",
  onClick
}: {
  game: GameState;
  cardId: CardId;
  location: Location;
  selected: boolean;
  orientation?: "vertical" | "horizontal";
  onClick: (location: Location) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: locationId("drag", location),
    data: { location } satisfies DragData
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={clsx("card-button", selected && "selected", isDragging && "dragging")}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        onClick(location);
      }}
      {...listeners}
      {...attributes}
    >
      <CardView card={game.cardsById[cardId]} orientation={orientation} />
    </button>
  );
}

function MovingStack({ cardIds, game }: { cardIds: CardId[]; game: GameState }) {
  return (
    <div className="moving-stack">
      {cardIds.map((cardId) => (
        <div className="moving-card" key={cardId}>
          <CardView card={game.cardsById[cardId]} />
        </div>
      ))}
    </div>
  );
}

function CardView({ card, orientation = "vertical", compact = false }: { card: Card; orientation?: "vertical" | "horizontal"; compact?: boolean }) {
  if (card.kind === "major") {
    return (
      <div className={clsx("card", "major-card", orientation === "horizontal" && "horizontal", compact && "compact")}>
        <div className="card-corner">{card.rank}</div>
        <div className="major-symbol">{majorSymbol(card.rank)}</div>
        <div className="major-name">{card.name.replace(/^The /, "")}</div>
      </div>
    );
  }

  return (
    <div className={clsx("card", "minor-card", `suit-${card.suit}`, orientation === "horizontal" && "horizontal", compact && "compact")}>
      <div className="card-corner">
        <span>{rankLabel(card.rank)}</span>
        <span>{suitIcon(card.suit)}</span>
      </div>
      <div className="minor-symbol">{suitIcon(card.suit)}</div>
      <div className="card-corner inverted">
        <span>{rankLabel(card.rank)}</span>
        <span>{suitIcon(card.suit)}</span>
      </div>
    </div>
  );
}

function topCard(cards: CardId[]): CardId | undefined {
  return cards[cards.length - 1];
}

function rankLabel(rank: number): string {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
}

function suitIcon(suit: Suit): string {
  switch (suit) {
    case "cups":
      return "C";
    case "swords":
      return "S";
    case "stars":
      return "*";
    case "thorns":
      return "T";
  }
}

function majorSymbol(rank: number): string {
  const symbols = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return symbols[rank] ?? String(rank);
}

function locationId(prefix: string, location: Location): string {
  switch (location.type) {
    case "tableau":
      return `${prefix}:tableau:${location.column}:${location.index ?? "top"}`;
    case "minor-foundation":
      return `${prefix}:minor-foundation:${location.suit}`;
    case "major-low":
      return `${prefix}:major-low`;
    case "major-high":
      return `${prefix}:major-high`;
    case "park":
      return `${prefix}:park`;
  }
}

function isSameLocation(left: Location | null, right: Location): boolean {
  if (!left || left.type !== right.type) {
    return false;
  }

  if (left.type === "tableau" && right.type === "tableau") {
    return left.column === right.column;
  }

  if (left.type === "minor-foundation" && right.type === "minor-foundation") {
    return left.suit === right.suit;
  }

  return true;
}
