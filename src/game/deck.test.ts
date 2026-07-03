import { describe, expect, it } from "vitest";
import { createDeck, createNewGame, minorCardId } from "./deck";
import { suits } from "./types";

describe("deck and deal", () => {
  it("creates a unique 74-card tarot deck", () => {
    const deck = createDeck();
    const ids = new Set(deck.map((card) => card.id));

    expect(deck).toHaveLength(74);
    expect(ids.size).toBe(74);
    expect(deck.filter((card) => card.kind === "minor")).toHaveLength(52);
    expect(deck.filter((card) => card.kind === "major")).toHaveLength(22);
  });

  it("starts minor aces in foundations and deals 70 cards into 10 columns plus one empty center column", () => {
    const state = createNewGame({ seed: "deal-shape" });

    for (const suit of suits) {
      expect(state.foundations.minor[suit]).toEqual([minorCardId(suit, 1)]);
    }

    expect(state.tableau).toHaveLength(11);
    expect(state.tableau[5]).toEqual([]);
    expect(state.tableau.filter((column) => column.length === 7)).toHaveLength(10);
    expect(state.tableau.flat()).toHaveLength(70);
    expect(state.parkedCard).toBeNull();
  });

  it("deals deterministically by seed", () => {
    const first = createNewGame({ seed: "same-seed" });
    const second = createNewGame({ seed: "same-seed" });
    const third = createNewGame({ seed: "different-seed" });

    expect(second.tableau).toEqual(first.tableau);
    expect(third.tableau).not.toEqual(first.tableau);
  });
});
