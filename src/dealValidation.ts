import { autoMoveFoundations, hashState, parseBoard, type State } from "./game.ts";

export type DealValidationResult =
  | {
      ok: true;
      state: State;
    }
  | {
      ok: false;
      errors: string[];
    };

const INITIAL_COLUMN_SIZES = [7, 7, 7, 7, 7, 0, 7, 7, 7, 7, 7];

export function validateInitialDeal(board: string): DealValidationResult {
  const errors: string[] = [];
  let state: State;

  try {
    state = parseBoard(board, { autoMove: false });
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  if (state.majorLow !== -1) errors.push(`Expected low major foundation -1, got ${state.majorLow}`);
  if (state.majorHigh !== 22) errors.push(`Expected high major foundation 22, got ${state.majorHigh}`);
  if (state.park !== null) errors.push(`Expected empty park, got ${state.park}`);
  if (state.minor.length !== 4 || state.minor.some((rank) => rank !== 1)) {
    errors.push(`Expected minor foundations 1,1,1,1, got ${state.minor.join(",")}`);
  }

  if (state.tableau.length !== INITIAL_COLUMN_SIZES.length) {
    errors.push(`Expected ${INITIAL_COLUMN_SIZES.length} tableau columns, got ${state.tableau.length}`);
  }

  for (let index = 0; index < Math.max(state.tableau.length, INITIAL_COLUMN_SIZES.length); index++) {
    const column = state.tableau[index] ?? [];
    const expected = INITIAL_COLUMN_SIZES[index];
    if (expected !== undefined && column.length !== expected) {
      errors.push(`Expected column ${index} to contain ${expected} cards, got ${column.length}`);
    }
  }

  const cardErrors = validateDealCards(state);
  errors.push(...cardErrors);

  if (errors.length === 0 && hashState(autoMoveFoundations(state)) !== hashState(state)) {
    errors.push("Initial deal has automatic foundation moves available");
  }

  return errors.length === 0 ? { ok: true, state } : { ok: false, errors };
}

export function expectedDealCards(): string[] {
  const cards: string[] = [];
  for (let rank = 0; rank <= 21; rank++) {
    cards.push(`M${rank}`);
  }
  for (const suit of ["C", "S", "A", "T"]) {
    for (let rank = 2; rank <= 13; rank++) {
      cards.push(`${suit}${rank}`);
    }
  }
  return cards;
}

function validateDealCards(state: State): string[] {
  const errors: string[] = [];
  const expected = new Set(expectedDealCards());
  const seen = new Map<string, number>();

  for (const card of state.tableau.flat()) {
    seen.set(card, (seen.get(card) ?? 0) + 1);
    if (!expected.has(card)) errors.push(`Unexpected card in tableau: ${card}`);
  }

  for (const card of expected) {
    const count = seen.get(card) ?? 0;
    if (count === 0) errors.push(`Missing card from tableau: ${card}`);
    if (count > 1) errors.push(`Duplicate card in tableau: ${card} appears ${count} times`);
  }

  for (const [card, count] of seen) {
    if (!expected.has(card) && count > 1) {
      errors.push(`Unexpected duplicate card in tableau: ${card} appears ${count} times`);
    }
  }

  return errors;
}
