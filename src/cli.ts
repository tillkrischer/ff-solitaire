import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { solveBoard } from "./solver.ts";

function main(): void {
  const [dealPath] = process.argv.slice(2);
  if (!dealPath) {
    console.error("Usage: node src/cli.ts data/deals/deal-01.txt");
    process.exitCode = 1;
    return;
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

main();
