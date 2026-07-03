import { INITIAL_STATE, cloneState, type Move } from "../game.ts";
import type { GenerateDealOptions, GenerateDealResult, GenerationStrategy } from "../generator.ts";
import {
  buildConstrainedFoundationSequence,
  emptyTableau,
  fillColumn,
  generateScriptedDeal,
  type Random,
  type ScriptedBuildResult,
} from "./shared.ts";

const STRATEGY_NAME = "multi-gate-cascade";
const PROOF_PATH: Move[] = [
  { fromType: "column", fromIndex: 0, toType: "column", toIndex: 5 },
  { fromType: "column", fromIndex: 6, toType: "column", toIndex: 5 },
  { fromType: "column", fromIndex: 7, toType: "column", toIndex: 5 },
];

export const multiGateCascadeStrategy: GenerationStrategy = {
  name: STRATEGY_NAME,
  generate: generateMultiGateCascadeDeal,
};

export function generateMultiGateCascadeDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  return generateScriptedDeal(options, STRATEGY_NAME, buildAttempt);
}

function buildAttempt(random: Random): ScriptedBuildResult | null {
  const sequence = buildConstrainedFoundationSequence(random, [
    { kind: "gate", index: 34 },
    { kind: "gate", index: 41 },
    { kind: "gate", index: 69 },
  ]);
  if (!sequence) return null;

  const tableau = emptyTableau();
  fillColumn(tableau, 0, sequence.slice(0, 6), sequence[34]);
  fillColumn(tableau, 1, sequence.slice(6, 13));
  fillColumn(tableau, 2, sequence.slice(13, 20));
  fillColumn(tableau, 3, sequence.slice(20, 27));
  fillColumn(tableau, 4, sequence.slice(27, 34));
  fillColumn(tableau, 6, sequence.slice(35, 41), sequence[41]);
  fillColumn(tableau, 7, sequence.slice(42, 48), sequence[69]);
  fillColumn(tableau, 8, sequence.slice(48, 55));
  fillColumn(tableau, 9, sequence.slice(55, 62));
  fillColumn(tableau, 10, sequence.slice(62, 69));

  return {
    state: { ...cloneState(INITIAL_STATE), tableau },
    proofPath: PROOF_PATH,
    metadata: {
      proof: STRATEGY_NAME,
      gates: 3,
      cascadeSegments: [34, 6, 27],
      gateMoves: ["empty-column", "empty-column", "empty-column"],
    },
  };
}
