import {
  multiGateCascadeStrategy,
  oneMoveConstructiveStrategy,
  orderedFiveColumnReverseShuffleStrategy,
  parkLockedMinorCascadeStrategy,
  randomReferenceSearchStrategy,
  referencePoolStrategy,
  inlineTestDealStrategy,
  reverseFoundationDealStrategy,
  reverseSolveWalkStrategy,
  scriptedTableauRearrangementStrategy,
} from "./generators/index.ts";
import { validateInitialDeal } from "./dealValidation.ts";

export type GenerateDealOptions = {
  seed?: string | number;
  maxAttempts?: number;
  strategy?: string;
};

export type GenerateDealResult = {
  board: string;
  seed: string;
  attempts: number;
  strategy: string;
  metadata?: Record<string, unknown>;
};

export type GenerationStrategy = {
  name: string;
  generate: (options: GenerateDealOptions) => GenerateDealResult;
};

export const DEFAULT_GENERATION_STRATEGY = "reference-pool";

const STRATEGIES = new Map<string, GenerationStrategy>();

registerStrategy(referencePoolStrategy);
registerStrategy(oneMoveConstructiveStrategy);
registerStrategy(multiGateCascadeStrategy);
registerStrategy(scriptedTableauRearrangementStrategy);
registerStrategy(parkLockedMinorCascadeStrategy);
registerStrategy(orderedFiveColumnReverseShuffleStrategy);
// registerStrategy(reverseSolveWalkStrategy);
registerStrategy(reverseFoundationDealStrategy);
registerStrategy(randomReferenceSearchStrategy);
registerStrategy(inlineTestDealStrategy);

export function generateDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  const strategyName = options.strategy ?? DEFAULT_GENERATION_STRATEGY;
  const strategy = STRATEGIES.get(strategyName);
  if (!strategy) {
    throw new Error(`Unknown generation strategy: ${strategyName}`);
  }
  const result = strategy.generate({ ...options, strategy: strategyName });
  const validation = validateInitialDeal(result.board);
  if (!validation.ok) {
    throw new Error(`Generation strategy ${strategyName} returned an invalid deal:\n${validation.errors.join("\n")}`);
  }
  return {
    ...result,
    strategy: strategyName,
    metadata: {
      ...result.metadata,
      validation: "ok",
    },
  };
}

export function listGenerationStrategies(): string[] {
  return [...STRATEGIES.keys()];
}

export function registerStrategy(strategy: GenerationStrategy): void {
  if (STRATEGIES.has(strategy.name)) {
    throw new Error(`Duplicate generation strategy: ${strategy.name}`);
  }
  STRATEGIES.set(strategy.name, strategy);
}
