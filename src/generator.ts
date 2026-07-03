import { generateConstructiveDeal } from "./generators/constructive.ts";

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
};

export type GenerationStrategy = {
  name: string;
  generate: (options: GenerateDealOptions) => GenerateDealResult;
};

const STRATEGIES = new Map<string, GenerationStrategy>();

registerStrategy({
  name: "constructive",
  generate: generateConstructiveDeal,
});

export function generateDeal(options: GenerateDealOptions = {}): GenerateDealResult {
  const strategyName = options.strategy ?? "constructive";
  const strategy = STRATEGIES.get(strategyName);
  if (!strategy) {
    throw new Error(`Unknown generation strategy: ${strategyName}`);
  }
  return strategy.generate({ ...options, strategy: strategyName });
}

export function listGenerationStrategies(): string[] {
  return [...STRATEGIES.keys()];
}

function registerStrategy(strategy: GenerationStrategy): void {
  if (STRATEGIES.has(strategy.name)) {
    throw new Error(`Duplicate generation strategy: ${strategy.name}`);
  }
  STRATEGIES.set(strategy.name, strategy);
}
