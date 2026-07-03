import { validateInitialDeal } from "./dealValidation.ts";
import { generateDeal, type GenerateDealOptions } from "./generator.ts";
import { solveBoard, type SolveMetrics, type SolveOptions } from "./solver.ts";

export type GenerationExperimentOptions = GenerateDealOptions & {
  count?: number;
  solve?: boolean;
  solveOptions?: SolveOptions;
};

export type GenerationExperimentResult = {
  index: number;
  seed: string;
  strategy: string;
  attempts: number;
  generateMs: number;
  board: string;
  metadata?: Record<string, unknown>;
  validation: {
    ok: boolean;
    errors: string[];
  };
  solve?: {
    solved: boolean;
    pathLength: number | null;
    visited: number;
    ms: number;
    metrics: SolveMetrics;
  };
  error?: string;
};

export function runGenerationExperiment(options: GenerationExperimentOptions = {}): GenerationExperimentResult[] {
  const count = options.count ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer: ${count}`);
  }

  const seedBase = String(options.seed ?? "default");
  const results: GenerationExperimentResult[] = [];

  for (let index = 0; index < count; index++) {
    const seed = count === 1 ? seedBase : `${seedBase}:${index + 1}`;
    results.push(runOne({ ...options, seed }, index + 1));
  }

  return results;
}

function runOne(options: GenerationExperimentOptions, index: number): GenerationExperimentResult {
  const started = Date.now();
  try {
    const generated = generateDeal(options);
    const generateMs = Date.now() - started;
    const validation = validateInitialDeal(generated.board);
    const result: GenerationExperimentResult = {
      index,
      seed: generated.seed,
      strategy: generated.strategy,
      attempts: generated.attempts,
      generateMs,
      board: generated.board,
      metadata: generated.metadata,
      validation: {
        ok: validation.ok,
        errors: validation.ok ? [] : validation.errors,
      },
    };

    if (options.solve) {
      const solved = solveBoard(generated.board, options.solveOptions);
      result.solve = {
        solved: solved.path !== null,
        pathLength: solved.path?.length ?? null,
        visited: solved.visited,
        ms: solved.ms,
        metrics: solved.metrics,
      };
    }

    return result;
  } catch (error) {
    return {
      index,
      seed: String(options.seed ?? "default"),
      strategy: options.strategy ?? "constructive",
      attempts: 0,
      generateMs: Date.now() - started,
      board: "",
      validation: {
        ok: false,
        errors: [],
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
