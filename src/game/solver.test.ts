import { describe, expect, it } from "vitest";
import { createDeck, createFoundations, indexCards, majorCardId, minorCardId } from "./deck";
import { generateLegalMoves, solve } from "./solver";
import type { CardId, GameState } from "./types";

function stateWith(tableau: CardId[][]): GameState {
  return {
    cardsById: indexCards(createDeck()),
    tableau: Array.from({ length: 11 }, (_, index) => tableau[index] ?? []),
    foundations: createFoundations(),
    parkedCard: null,
    moveMode: "single-card",
    history: [],
    seed: "solver-test",
    status: "playing"
  };
}

describe("solver", () => {
  it("generates legal manual moves", () => {
    const state = stateWith([[minorCardId("cups", 4)], [minorCardId("cups", 5)], [majorCardId(0)]]);
    const moves = generateLegalMoves(state);

    expect(moves).toContainEqual({
      from: { type: "tableau", column: 0 },
      to: { type: "tableau", column: 1 }
    });
    expect(moves).toContainEqual({
      from: { type: "tableau", column: 2 },
      to: { type: "major-low" }
    });
  });

  it("finds a solution for a small handcrafted state", () => {
    const foundations = createFoundations();
    const state: GameState = {
      cardsById: indexCards(createDeck()),
      tableau: Array.from({ length: 11 }, () => []),
      foundations: {
        minor: {
          cups: Array.from({ length: 13 }, (_, index) => minorCardId("cups", (index + 1) as 1)),
          swords: Array.from({ length: 13 }, (_, index) => minorCardId("swords", (index + 1) as 1)),
          stars: Array.from({ length: 13 }, (_, index) => minorCardId("stars", (index + 1) as 1)),
          thorns: foundations.minor.thorns
        },
        majorLow: Array.from({ length: 11 }, (_, index) => majorCardId(index as never)),
        majorHigh: Array.from({ length: 11 }, (_, index) => majorCardId((21 - index) as never))
      },
      parkedCard: null,
      moveMode: "single-card",
      history: [],
      seed: "small-solved",
      status: "playing"
    };
    state.tableau[0] = Array.from({ length: 12 }, (_, index) => minorCardId("thorns", (13 - index) as never));

    const result = solve(state, { maxVisitedStates: 100, maxDepth: 12 });

    expect(result.solvable).toBe(true);
    if (result.solvable) {
      expect(result.moves).toHaveLength(1);
    }
  });

  it("reports the visit limit when the cap is reached", () => {
    const state = stateWith([[minorCardId("cups", 4)], [minorCardId("cups", 5)], [majorCardId(0)]]);
    const result = solve(state, { maxVisitedStates: 1 });

    expect(result).toEqual({ solvable: false, visitedStates: 1, reason: "limit" });
  });
});
