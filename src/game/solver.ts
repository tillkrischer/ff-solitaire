import type { GameState, MoveCommand, SolverResult } from "./types";
import { applyMove, canMove, hashState, isWon } from "./rules";

export type SolverOptions = {
  maxVisitedStates?: number;
  maxDepth?: number;
};

type SolverNode = {
  state: GameState;
  moves: MoveCommand[];
};

export function solve(initialState: GameState, options: SolverOptions = {}): SolverResult {
  const maxVisitedStates = options.maxVisitedStates ?? 100_000;
  const maxDepth = options.maxDepth ?? 500;
  const stack: SolverNode[] = [{ state: initialState, moves: [] }];
  const visited = new Set<string>();
  let visitedStates = 0;

  while (stack.length > 0) {
    if (visitedStates >= maxVisitedStates) {
      return { solvable: false, visitedStates, reason: "limit" };
    }

    const node = stack.pop();
    if (!node) {
      break;
    }

    const key = hashState(node.state);
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    visitedStates += 1;

    if (isWon(node.state)) {
      return { solvable: true, moves: node.moves, visitedStates };
    }

    if (node.moves.length >= maxDepth) {
      continue;
    }

    const legalMoves = generateLegalMoves(node.state);
    for (let index = legalMoves.length - 1; index >= 0; index -= 1) {
      const move = legalMoves[index];
      const nextState = applyMove(node.state, move);
      if (nextState !== node.state) {
        stack.push({ state: nextState, moves: [...node.moves, move] });
      }
    }
  }

  return { solvable: false, visitedStates, reason: "exhausted" };
}

export function generateLegalMoves(state: GameState): MoveCommand[] {
  const moves: MoveCommand[] = [];
  const sources: MoveCommand["from"][] = [];

  for (let column = 0; column < state.tableau.length; column += 1) {
    if (state.tableau[column].length > 0) {
      sources.push({ type: "tableau", column });
    }
  }

  if (state.parkedCard) {
    sources.push({ type: "park" });
  }

  const destinations: MoveCommand["to"][] = [
    ...state.tableau.map((_, column) => ({ type: "tableau" as const, column })),
    { type: "park" },
    { type: "minor-foundation", suit: "cups" },
    { type: "minor-foundation", suit: "swords" },
    { type: "minor-foundation", suit: "stars" },
    { type: "minor-foundation", suit: "thorns" },
    { type: "major-low" },
    { type: "major-high" }
  ];

  for (const from of sources) {
    for (const to of destinations) {
      const move = { from, to };
      if (canMove(state, move)) {
        moves.push(move);
      }
    }
  }

  return prioritizeMoves(state, moves);
}

function prioritizeMoves(state: GameState, moves: MoveCommand[]): MoveCommand[] {
  return [...moves].sort((left, right) => moveScore(state, right) - moveScore(state, left));
}

function moveScore(state: GameState, move: MoveCommand): number {
  let score = 0;

  if (move.to.type !== "tableau" && move.to.type !== "park") {
    score += 100;
  }

  if (move.to.type === "tableau" && state.tableau[move.to.column].length === 0) {
    score += 20;
  }

  if (move.from.type === "tableau" && state.tableau[move.from.column].length === 1) {
    score += 30;
  }

  if (move.from.type === "park") {
    score += 15;
  }

  if (move.to.type === "park") {
    score -= 10;
  }

  return score;
}
