import { describe, expect, it } from "vitest";
import { createDeck, createFoundations, indexCards, majorCardId, minorCardId } from "./deck";
import {
  applyMove,
  autoMoveFoundations,
  canMove,
  canStackOnTableau,
  getMovableCards,
  isWon,
  undo
} from "./rules";
import type { CardId, GameState, MoveMode } from "./types";

function stateWith(options: {
  tableau?: CardId[][];
  parkedCard?: CardId | null;
  moveMode?: MoveMode;
  majorLow?: CardId[];
  majorHigh?: CardId[];
  extraFoundations?: Partial<GameState["foundations"]["minor"]>;
}): GameState {
  const foundations = createFoundations();

  return {
    cardsById: indexCards(createDeck()),
    tableau: Array.from({ length: 11 }, (_, index) => options.tableau?.[index] ?? []),
    foundations: {
      minor: {
        ...foundations.minor,
        ...options.extraFoundations
      },
      majorLow: options.majorLow ?? [],
      majorHigh: options.majorHigh ?? []
    },
    parkedCard: options.parkedCard ?? null,
    moveMode: options.moveMode ?? "entire-stack",
    history: [],
    seed: "test",
    status: "playing"
  };
}

describe("tableau rules", () => {
  it("allows same-suit minor adjacency and major adjacency in either direction", () => {
    const cardsById = indexCards(createDeck());

    expect(canStackOnTableau(cardsById[minorCardId("cups", 5)], cardsById[minorCardId("cups", 4)])).toBe(true);
    expect(canStackOnTableau(cardsById[minorCardId("cups", 5)], cardsById[minorCardId("cups", 6)])).toBe(true);
    expect(canStackOnTableau(cardsById[majorCardId(13)], cardsById[majorCardId(14)])).toBe(true);
    expect(canStackOnTableau(cardsById[majorCardId(13)], cardsById[majorCardId(12)])).toBe(true);
  });

  it("rejects mixed suits, mixed kinds, and non-adjacent ranks", () => {
    const cardsById = indexCards(createDeck());

    expect(canStackOnTableau(cardsById[minorCardId("cups", 5)], cardsById[minorCardId("swords", 4)])).toBe(false);
    expect(canStackOnTableau(cardsById[minorCardId("cups", 5)], cardsById[minorCardId("cups", 7)])).toBe(false);
    expect(canStackOnTableau(cardsById[minorCardId("cups", 5)], cardsById[majorCardId(4)])).toBe(false);
  });

  it("allows moving an exposed top card to an empty tableau column", () => {
    const state = stateWith({
      tableau: [[minorCardId("cups", 4)], []],
      moveMode: "single-card"
    });

    expect(canMove(state, { from: { type: "tableau", column: 0 }, to: { type: "tableau", column: 1 } })).toBe(true);
  });

  it("parks one exposed card and rejects parking while occupied", () => {
    const emptyParkState = stateWith({
      tableau: [[minorCardId("cups", 4)]],
      moveMode: "single-card"
    });
    const occupiedParkState = stateWith({
      tableau: [[minorCardId("cups", 4)]],
      parkedCard: minorCardId("swords", 4),
      moveMode: "single-card"
    });

    expect(canMove(emptyParkState, { from: { type: "tableau", column: 0 }, to: { type: "park" } })).toBe(true);
    expect(canMove(occupiedParkState, { from: { type: "tableau", column: 0 }, to: { type: "park" } })).toBe(false);
  });
});

describe("movement modes", () => {
  it("single-card mode moves only the exposed card", () => {
    const state = stateWith({
      tableau: [[minorCardId("cups", 7), minorCardId("cups", 8), minorCardId("cups", 9)], [minorCardId("cups", 10)]],
      moveMode: "single-card"
    });

    const next = applyMove(state, { from: { type: "tableau", column: 0 }, to: { type: "tableau", column: 1 } });

    expect(next.tableau[0]).toEqual([minorCardId("cups", 7), minorCardId("cups", 8)]);
    expect(next.tableau[1]).toEqual([minorCardId("cups", 10), minorCardId("cups", 9)]);
  });

  it("entire-stack mode moves the compatible exposed run as repeated single-card moves would", () => {
    const state = stateWith({
      tableau: [[minorCardId("cups", 7), minorCardId("cups", 8), minorCardId("cups", 9)], [minorCardId("cups", 10)]],
      moveMode: "entire-stack"
    });

    expect(getMovableCards(state, { type: "tableau", column: 0 })).toEqual([
      minorCardId("cups", 9),
      minorCardId("cups", 8),
      minorCardId("cups", 7)
    ]);

    const next = applyMove(state, { from: { type: "tableau", column: 0 }, to: { type: "tableau", column: 1 } });

    expect(next.tableau[0]).toEqual([]);
    expect(next.tableau[1]).toEqual([
      minorCardId("cups", 10),
      minorCardId("cups", 9),
      minorCardId("cups", 8),
      minorCardId("cups", 7)
    ]);
  });
});

describe("foundation and parking rules", () => {
  it("blocks all minor foundations while any card is parked", () => {
    const state = stateWith({
      tableau: [[minorCardId("cups", 2)]],
      parkedCard: majorCardId(10),
      moveMode: "single-card"
    });

    expect(
      canMove(state, {
        from: { type: "tableau", column: 0 },
        to: { type: "minor-foundation", suit: "cups" }
      })
    ).toBe(false);
  });

  it("allows major foundations while a card is parked", () => {
    const state = stateWith({
      tableau: [[majorCardId(0)]],
      parkedCard: minorCardId("cups", 10),
      moveMode: "single-card"
    });

    expect(canMove(state, { from: { type: "tableau", column: 0 }, to: { type: "major-low" } })).toBe(true);
  });

  it("builds major foundations from 0 upward and 21 downward", () => {
    const lowState = stateWith({
      tableau: [[majorCardId(1)]],
      majorLow: [majorCardId(0)],
      moveMode: "single-card"
    });
    const highState = stateWith({
      tableau: [[majorCardId(20)]],
      majorHigh: [majorCardId(21)],
      moveMode: "single-card"
    });

    expect(canMove(lowState, { from: { type: "tableau", column: 0 }, to: { type: "major-low" } })).toBe(true);
    expect(canMove(highState, { from: { type: "tableau", column: 0 }, to: { type: "major-high" } })).toBe(true);
  });
});

describe("auto-foundation sweep", () => {
  it("repeatedly sweeps tableau cards from left to right", () => {
    const state = stateWith({
      tableau: [[minorCardId("cups", 3)], [minorCardId("cups", 2)]],
      moveMode: "single-card"
    });

    const next = autoMoveFoundations(state);

    expect(next.tableau[0]).toEqual([]);
    expect(next.tableau[1]).toEqual([]);
    expect(next.foundations.minor.cups).toEqual([
      minorCardId("cups", 1),
      minorCardId("cups", 2),
      minorCardId("cups", 3)
    ]);
  });

  it("auto-plays a parked major card", () => {
    const state = stateWith({
      parkedCard: majorCardId(0),
      moveMode: "single-card"
    });

    const next = autoMoveFoundations(state);

    expect(next.parkedCard).toBeNull();
    expect(next.foundations.majorLow).toEqual([majorCardId(0)]);
  });

  it("does not auto-play a parked minor card because the park blocks minor foundations", () => {
    const state = stateWith({
      parkedCard: minorCardId("cups", 2),
      moveMode: "single-card"
    });

    const next = autoMoveFoundations(state);

    expect(next.parkedCard).toBe(minorCardId("cups", 2));
    expect(next.foundations.minor.cups).toEqual([minorCardId("cups", 1)]);
  });
});

describe("undo", () => {
  it("undoes the manual move and all automatic moves caused by it", () => {
    const state = stateWith({
      tableau: [[minorCardId("cups", 2)], [majorCardId(0)]],
      moveMode: "single-card"
    });

    const moved = applyMove(state, { from: { type: "tableau", column: 1 }, to: { type: "major-low" } });

    expect(moved.foundations.majorLow).toEqual([majorCardId(0)]);
    expect(moved.foundations.minor.cups).toEqual([minorCardId("cups", 1), minorCardId("cups", 2)]);

    const restored = undo(moved);

    expect(restored.tableau).toEqual(state.tableau);
    expect(restored.foundations).toEqual(state.foundations);
    expect(restored.history).toEqual([]);
  });
});

describe("win detection", () => {
  it("recognizes a completed state", () => {
    const completeMinor = {
      cups: Array.from({ length: 13 }, (_, index) => minorCardId("cups", (index + 1) as never)),
      swords: Array.from({ length: 13 }, (_, index) => minorCardId("swords", (index + 1) as never)),
      stars: Array.from({ length: 13 }, (_, index) => minorCardId("stars", (index + 1) as never)),
      thorns: Array.from({ length: 13 }, (_, index) => minorCardId("thorns", (index + 1) as never))
    };
    const state = stateWith({
      extraFoundations: completeMinor,
      majorLow: Array.from({ length: 11 }, (_, index) => majorCardId(index as never)),
      majorHigh: Array.from({ length: 11 }, (_, index) => majorCardId((21 - index) as never))
    });

    expect(isWon(state)).toBe(true);
  });
});
