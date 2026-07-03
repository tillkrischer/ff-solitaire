import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { generateDeal, listGenerationStrategies, type GenerateDealOptions } from "./generator.ts";
import { solveBoard } from "./solver.ts";

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
    return;
  }

  console.log(`${name}: solved in ${result.path.length} moves, ${result.visited.toLocaleString()} states, ${result.ms}ms`);
  console.log(result.path.map((move, index) => `Step ${index + 1}: ${move}`).join("\n"));
}

function generate(args: string[]): void {
  if (args.includes("--list-strategies")) {
    console.log(listGenerationStrategies().join("\n"));
    return;
  }
  const result = generateDeal(parseGenerateArgs(args));
  console.log(result.board);
}

function parseGenerateArgs(args: string[]): GenerateDealOptions {
  const options: GenerateDealOptions = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--seed") {
      const value = args[++index];
      if (value === undefined) throw new Error("--seed requires a value");
      options.seed = value;
    } else if (arg === "--max-attempts") {
      const value = args[++index];
      if (value === undefined) throw new Error("--max-attempts requires a value");
      options.maxAttempts = Number(value);
    } else if (arg === "--strategy") {
      const value = args[++index];
      if (value === undefined) throw new Error("--strategy requires a value");
      options.strategy = value;
    } else {
      throw new Error(`Unknown generate argument: ${arg}`);
    }
  }
  return options;
}

main();
