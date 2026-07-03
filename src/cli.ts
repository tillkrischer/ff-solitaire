import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { runGenerationExperiment } from "./generationHarness.ts";
import { generateDeal, listGenerationStrategies, type GenerateDealOptions } from "./generator.ts";
import { solveBoard, type SolveMetrics, type SolveOptions } from "./solver.ts";

function main(): void {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function run(args: string[]): void {
  const [command, ...rest] = args;
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
    } else {
      throw new Error(`Unknown generate argument: ${arg}`);
    }
  }
  return {
    generate: generateOptions,
    experiment: experimentOptions,
  };
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
