import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { runGenerationExperiment } from "./generationHarness.ts";
import { generateDeal, listGenerationStrategies, type GenerateDealOptions, type GenerateDealResult } from "./generator.ts";
import { runStandaloneRandomReferenceBulk, type StandaloneRandomReferenceOptions } from "./standaloneRandomReference/index.ts";
import { solveBoard, type SolveMetrics, type SolveOptions } from "./solver.ts";

function main(): void {
  run(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function run(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === "random-reference-bulk") {
    await runStandaloneRandomReferenceBulk(parseStandaloneRandomReferenceArgs(rest));
    return;
  }
  if (command === "generate") {
    generate(rest);
    return;
  }
  if (command === "solve") {
    solve(rest);
    return;
  }
  solve(args);
}

function parseStandaloneRandomReferenceArgs(args: string[]): StandaloneRandomReferenceOptions {
  const options: Partial<StandaloneRandomReferenceOptions> = {
    seed: "reference",
    maxVisited: 250_000,
    beam: 1000,
    trimEvery: 10_000,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--seed") {
      options.seed = readRequiredValue(args, ++index, arg);
    } else if (arg === "--attempts") {
      options.attempts = Number(readRequiredValue(args, ++index, arg));
    } else if (arg === "--target-count") {
      options.targetCount = Number(readRequiredValue(args, ++index, arg));
    } else if (arg === "--workers") {
      options.workers = Number(readRequiredValue(args, ++index, arg));
    } else if (arg === "--chunk-size") {
      options.chunkSize = Number(readRequiredValue(args, ++index, arg));
    } else if (arg === "--out-dir") {
      options.outDir = readRequiredValue(args, ++index, arg);
    } else if (arg === "--max-visited") {
      options.maxVisited = Number(readRequiredValue(args, ++index, arg));
    } else if (arg === "--beam") {
      options.beam = Number(readRequiredValue(args, ++index, arg));
    } else if (arg === "--trim-every") {
      options.trimEvery = Number(readRequiredValue(args, ++index, arg));
    } else if (arg === "--overwrite") {
      options.overwrite = true;
    } else {
      throw new Error(`Unknown random-reference-bulk argument: ${arg}`);
    }
  }

  const missing = [];
  if (options.attempts === undefined) missing.push("--attempts");
  if (options.targetCount === undefined) missing.push("--target-count");
  if (options.outDir === undefined) missing.push("--out-dir");
  if (missing.length > 0) {
    throw new Error(
      `Usage: node src/cli.ts random-reference-bulk --attempts 1000000 --target-count 500 --out-dir data/reference-generated [--seed reference] [--workers 16]\nMissing required arguments: ${missing.join(", ")}`,
    );
  }

  return options as StandaloneRandomReferenceOptions;
}

function readRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function solve(args: string[]): void {
  const [dealPath] = args;
  if (!dealPath) {
    throw new Error("Usage: node src/cli.ts solve data/deals/deal-01.txt");
  }

  if (dealPath.startsWith("--")) {
    throw new Error(`Unknown solve argument: ${dealPath}`);
  }

  const board = readFileSync(dealPath, "utf8");
  const result = solveBoard(board);
  const name = basename(dealPath, ".txt");

  if (!result.path) {
    console.log(`${name}: unsolved after ${result.visited.toLocaleString()} states in ${result.ms}ms`);
    console.log(formatMetrics(result.metrics));
    return;
  }

  console.log(`${name}: solved in ${result.path.length} moves, ${result.visited.toLocaleString()} states, ${result.ms}ms`);
  console.log(formatMetrics(result.metrics));
  console.log(result.path.map((move, index) => `Step ${index + 1}: ${move}`).join("\n"));
}

function generate(args: string[]): void {
  if (args.includes("--list-strategies")) {
    console.log(listGenerationStrategies().join("\n"));
    return;
  }
  const options = parseGenerateArgs(args);
  if (options.bulk.outDir) {
    bulkGenerate(options.generate, options.experiment, options.bulk);
    return;
  }

  if (options.experiment.count === 1 && !options.experiment.jsonl && !options.experiment.solve) {
    const result = generateDeal(options.generate);
    console.log(result.board);
    return;
  }

  const results = runGenerationExperiment({
    ...options.generate,
    count: options.experiment.count,
    solve: options.experiment.solve,
    solveOptions: options.experiment.solveOptions,
  });

  if (options.experiment.jsonl) {
    for (const result of results) {
      console.log(JSON.stringify(result));
    }
    return;
  }

  for (const result of results) {
    const status = result.error ? `error: ${result.error}` : summarizeGenerationResult(result);
    console.log(`${result.index}. ${result.strategy} seed=${result.seed}: ${status}`);
    if (options.experiment.printBoards && result.board) console.log(result.board);
  }
}

function parseGenerateArgs(args: string[]): {
  generate: GenerateDealOptions;
  experiment: {
    count: number;
    jsonl: boolean;
    printBoards: boolean;
    solve: boolean;
    solveOptions: {
      beam?: number;
      trimEvery?: number;
      maxVisited?: number;
    };
  };
  bulk: {
    outDir?: string;
    manifest?: string;
    prefix: string;
    startIndex: number;
    padWidth?: number;
    overwrite: boolean;
  };
} {
  const generateOptions: GenerateDealOptions = {};
  const solveOptions: SolveOptions = {};
  const experimentOptions = {
    count: 1,
    jsonl: false,
    printBoards: false,
    solve: false,
    solveOptions,
  };
  const bulkOptions = {
    outDir: undefined as string | undefined,
    manifest: undefined as string | undefined,
    prefix: "deal",
    startIndex: 1,
    padWidth: undefined as number | undefined,
    overwrite: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--seed") {
      const value = args[++index];
      if (value === undefined) throw new Error("--seed requires a value");
      generateOptions.seed = value;
    } else if (arg === "--max-attempts") {
      const value = args[++index];
      if (value === undefined) throw new Error("--max-attempts requires a value");
      generateOptions.maxAttempts = Number(value);
    } else if (arg === "--strategy") {
      const value = args[++index];
      if (value === undefined) throw new Error("--strategy requires a value");
      generateOptions.strategy = value;
    } else if (arg === "--count") {
      const value = args[++index];
      if (value === undefined) throw new Error("--count requires a value");
      experimentOptions.count = Number(value);
    } else if (arg === "--jsonl") {
      experimentOptions.jsonl = true;
    } else if (arg === "--print-boards") {
      experimentOptions.printBoards = true;
    } else if (arg === "--solve") {
      experimentOptions.solve = true;
    } else if (arg === "--solve-max-visited") {
      const value = args[++index];
      if (value === undefined) throw new Error("--solve-max-visited requires a value");
      experimentOptions.solve = true;
      experimentOptions.solveOptions.maxVisited = Number(value);
    } else if (arg === "--solve-beam") {
      const value = args[++index];
      if (value === undefined) throw new Error("--solve-beam requires a value");
      experimentOptions.solve = true;
      experimentOptions.solveOptions.beam = Number(value);
    } else if (arg === "--solve-trim-every") {
      const value = args[++index];
      if (value === undefined) throw new Error("--solve-trim-every requires a value");
      experimentOptions.solve = true;
      experimentOptions.solveOptions.trimEvery = Number(value);
    } else if (arg === "--out-dir") {
      const value = args[++index];
      if (value === undefined) throw new Error("--out-dir requires a value");
      bulkOptions.outDir = value;
    } else if (arg === "--manifest") {
      const value = args[++index];
      if (value === undefined) throw new Error("--manifest requires a value");
      bulkOptions.manifest = value;
    } else if (arg === "--prefix") {
      const value = args[++index];
      if (value === undefined) throw new Error("--prefix requires a value");
      bulkOptions.prefix = value;
    } else if (arg === "--start-index") {
      const value = args[++index];
      if (value === undefined) throw new Error("--start-index requires a value");
      bulkOptions.startIndex = Number(value);
    } else if (arg === "--pad-width") {
      const value = args[++index];
      if (value === undefined) throw new Error("--pad-width requires a value");
      bulkOptions.padWidth = Number(value);
    } else if (arg === "--overwrite") {
      bulkOptions.overwrite = true;
    } else {
      throw new Error(`Unknown generate argument: ${arg}`);
    }
  }
  validateBulkOptions(experimentOptions, bulkOptions);
  return {
    generate: generateOptions,
    experiment: experimentOptions,
    bulk: bulkOptions,
  };
}

type BulkGenerateOptions = ReturnType<typeof parseGenerateArgs>["bulk"];
type BulkExperimentOptions = ReturnType<typeof parseGenerateArgs>["experiment"];

type BulkManifestEntry = {
  index: number;
  file: string;
  seed: string;
  strategy: string;
  attempts: number;
  generateMs: number;
  metadata?: Record<string, unknown>;
  solve?: {
    solved: boolean;
    pathLength: number | null;
    visited: number;
    ms: number;
    metrics: SolveMetrics;
  };
};

function bulkGenerate(
  generateOptions: GenerateDealOptions,
  experimentOptions: BulkExperimentOptions,
  bulkOptions: BulkGenerateOptions,
): void {
  if (!bulkOptions.outDir) throw new Error("--out-dir is required for bulk generation");
  const count = experimentOptions.count;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer: ${count}`);
  }

  const outDir = resolve(bulkOptions.outDir);
  const manifestPath = resolve(bulkOptions.manifest ?? join(outDir, "manifest.json"));
  const seedBase = String(generateOptions.seed ?? "default");
  const endIndex = bulkOptions.startIndex + count - 1;
  const padWidth = bulkOptions.padWidth ?? Math.max(2, String(endIndex).length);
  const started = Date.now();
  const entries: BulkManifestEntry[] = [];
  const dealPaths = Array.from({ length: count }, (_, offset) => {
    const dealIndex = bulkOptions.startIndex + offset;
    const fileName = `${bulkOptions.prefix}-${String(dealIndex).padStart(padWidth, "0")}.txt`;
    return join(outDir, fileName);
  });

  mkdirSync(outDir, { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  for (const path of [manifestPath, ...dealPaths]) {
    assertWritableTarget(path, bulkOptions.overwrite);
  }

  for (let offset = 0; offset < count; offset++) {
    const dealIndex = bulkOptions.startIndex + offset;
    const filePath = dealPaths[offset];

    const seed = `${seedBase}:${dealIndex}`;
    const generated = timedGenerate({ ...generateOptions, seed });
    const solved = experimentOptions.solve ? solveBoard(generated.result.board, experimentOptions.solveOptions) : null;
    writeFileSync(filePath, `${generated.result.board}\n`);
    entries.push({
      index: dealIndex,
      file: relative(dirname(manifestPath), filePath),
      seed: generated.result.seed,
      strategy: generated.result.strategy,
      attempts: generated.result.attempts,
      generateMs: generated.ms,
      metadata: generated.result.metadata,
      ...(solved
        ? {
            solve: {
              solved: solved.path !== null,
              pathLength: solved.path?.length ?? null,
              visited: solved.visited,
              ms: solved.ms,
              metrics: solved.metrics,
            },
          }
        : {}),
    });
    console.log(
      `${entries.length}/${count} ${relative(process.cwd(), filePath)} seed=${generated.result.seed} attempts=${generated.result.attempts} ms=${generated.ms}${solved ? ` solve=${solved.path ? `${solved.path.length} moves` : "unsolved"}` : ""}`,
    );
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    strategy: generateOptions.strategy ?? "one-move-constructive",
    seedBase,
    count,
    startIndex: bulkOptions.startIndex,
    maxAttempts: generateOptions.maxAttempts,
    totalMs: Date.now() - started,
    deals: entries,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${count} deals and manifest ${relative(process.cwd(), manifestPath)}`);
}

function timedGenerate(options: GenerateDealOptions): { result: GenerateDealResult; ms: number } {
  const started = Date.now();
  const result = generateDeal(options);
  return { result, ms: Date.now() - started };
}

function assertWritableTarget(path: string, overwrite: boolean): void {
  if (!overwrite && existsSync(path)) {
    throw new Error(`Refusing to overwrite existing file: ${path}\nPass --overwrite to replace existing generated files.`);
  }
}

function validateBulkOptions(
  experimentOptions: {
    count: number;
    jsonl: boolean;
    printBoards: boolean;
  },
  bulkOptions: {
    outDir?: string;
    manifest?: string;
    prefix: string;
    startIndex: number;
    padWidth?: number;
    overwrite: boolean;
  },
): void {
  if (!bulkOptions.outDir && !bulkOptions.manifest) return;
  if (!bulkOptions.outDir) throw new Error("--manifest requires --out-dir");
  if (experimentOptions.jsonl) throw new Error("--jsonl cannot be combined with --out-dir");
  if (experimentOptions.printBoards) throw new Error("--print-boards cannot be combined with --out-dir");
  const count = experimentOptions.count;
  if (!Number.isInteger(count) || count < 1) throw new Error(`count must be a positive integer: ${count}`);
  if (!Number.isInteger(bulkOptions.startIndex) || bulkOptions.startIndex < 1) {
    throw new Error(`startIndex must be a positive integer: ${bulkOptions.startIndex}`);
  }
  if (bulkOptions.padWidth !== undefined && (!Number.isInteger(bulkOptions.padWidth) || bulkOptions.padWidth < 1)) {
    throw new Error(`padWidth must be a positive integer: ${bulkOptions.padWidth}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(bulkOptions.prefix)) {
    throw new Error(`prefix may only contain letters, numbers, dots, underscores, and dashes: ${bulkOptions.prefix}`);
  }
}

function summarizeGenerationResult(result: ReturnType<typeof runGenerationExperiment>[number]): string {
  const validation = result.validation.ok ? "valid" : `invalid(${result.validation.errors.length})`;
  const solve = result.solve
    ? `, solve=${result.solve.solved ? `${result.solve.pathLength} moves` : "unsolved"} visited=${result.solve.visited.toLocaleString()} ms=${result.solve.ms} ${formatMetrics(result.solve.metrics)}`
    : "";
  return `attempts=${result.attempts} ms=${result.generateMs} ${validation}${solve}`;
}

function formatMetrics(metrics: SolveMetrics): string {
  return [
    `metrics: peakFrontier=${metrics.peakFrontier.toLocaleString()}`,
    `avgBranching=${formatNumber(metrics.avgBranching)}`,
    `maxBranching=${metrics.maxBranching}`,
    `duplicates=${metrics.duplicateSkips.toLocaleString()}`,
    `trims=${metrics.trimCount}/${metrics.trimmedNodes.toLocaleString()}`,
    `drought=${metrics.longestFoundationDrought}`,
    `maxCascade=${metrics.maxCascadeSize}`,
    `park=${metrics.movesToPark}/${metrics.movesFromPark}`,
    `blockedMinor=${metrics.parkBlockedMinorOpportunities}`,
    `emptyAvg=${formatNumber(metrics.avgEmptyColumns)}`,
    `initialBlockers=${metrics.initialBlockerScore}`,
  ].join(" ");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

main();
