import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import {
  addCounters,
  emptyCounters,
  type BulkSearchOptions,
  type Candidate,
  type SearchCounters,
  type WorkerChunkRequest,
  type WorkerChunkResult,
} from "./core.ts";

export type StandaloneRandomReferenceOptions = BulkSearchOptions & {
  attempts: number;
  targetCount: number;
  workers?: number;
  chunkSize?: number;
  outDir: string;
  overwrite?: boolean;
};

type WorkerState = {
  worker: Worker;
  busy: boolean;
};

export async function runStandaloneRandomReferenceBulk(options: StandaloneRandomReferenceOptions): Promise<void> {
  validateOptions(options);

  const outDir = resolve(options.outDir);
  if (existsSync(outDir) && !options.overwrite) {
    throw new Error(`Refusing to write into existing output directory: ${outDir}\nPass --overwrite to replace output files.`);
  }
  mkdirSync(outDir, { recursive: true });

  const started = Date.now();
  const workerCount = options.workers ?? Math.max(1, availableParallelism() - 1);
  const chunkSize = options.chunkSize ?? 100;
  const counters = emptyCounters();
  const retained: Candidate[] = [];
  const seenBoards = new Set<string>();
  let nextAttempt = 1;
  let completedAttempts = 0;
  let completedChunks = 0;
  let closedWorkers = 0;
  let settled = false;

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const workers: WorkerState[] = Array.from({ length: workerCount }, () => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url));
      return { worker, busy: false };
    });

    const progressTimer = setInterval(() => {
      printProgress({
        completedAttempts,
        totalAttempts: options.attempts,
        retained: retained.length,
        targetCount: options.targetCount,
        counters,
        started,
      });
    }, 5000);
    progressTimer.unref();

    function finishIfDone(): void {
      if (settled || closedWorkers !== workers.length) return;
      settled = true;
      clearInterval(progressTimer);
      resolvePromise();
    }

    function fail(error: unknown): void {
      if (settled) return;
      settled = true;
      clearInterval(progressTimer);
      for (const state of workers) {
        void state.worker.terminate();
      }
      rejectPromise(error);
    }

    function assign(state: WorkerState): void {
      if (settled) return;
      if (nextAttempt > options.attempts) {
        state.worker.postMessage({ stop: true });
        return;
      }
      const attempts = Math.min(chunkSize, options.attempts - nextAttempt + 1);
      const request: WorkerChunkRequest = {
        seed: options.seed,
        maxVisited: options.maxVisited,
        beam: options.beam,
        trimEvery: options.trimEvery,
        startAttempt: nextAttempt,
        attempts,
      };
      nextAttempt += attempts;
      state.busy = true;
      state.worker.postMessage(request);
    }

    for (const state of workers) {
      state.worker.on("message", (result: WorkerChunkResult) => {
        state.busy = false;
        completedAttempts += result.attempts;
        completedChunks++;
        addCounters(counters, result.counters);
        retainCandidates(retained, seenBoards, result.candidates, options.targetCount);
        assign(state);
      });
      state.worker.on("error", fail);
      state.worker.on("exit", (code) => {
        closedWorkers++;
        if (code !== 0 && !settled) {
          fail(new Error(`standalone random reference worker exited with code ${code}`));
          return;
        }
        finishIfDone();
      });
      assign(state);
    }
  });

  retained.sort((a, b) => a.score - b.score);
  const totalMs = Date.now() - started;
  writeOutputs(outDir, options, workerCount, completedChunks, totalMs, counters, retained);
  printProgress({
    completedAttempts,
    totalAttempts: options.attempts,
    retained: retained.length,
    targetCount: options.targetCount,
    counters,
    started,
    final: true,
  });
  console.log(`Wrote ${retained.length} deals to ${join(outDir, "deals.txt")}`);
}

function retainCandidates(retained: Candidate[], seenBoards: Set<string>, candidates: Candidate[], targetCount: number): void {
  for (const candidate of candidates) {
    if (seenBoards.has(candidate.boardHash)) continue;
    seenBoards.add(candidate.boardHash);
    retained.push(candidate);
  }
  if (retained.length <= targetCount) return;
  retained.sort((a, b) => a.score - b.score);
  retained.length = targetCount;
}

function writeOutputs(
  outDir: string,
  options: StandaloneRandomReferenceOptions,
  workerCount: number,
  completedChunks: number,
  totalMs: number,
  counters: SearchCounters,
  retained: Candidate[],
): void {
  const dealLines = retained.map((candidate) => candidate.board).join("\n");
  const manifestLines = retained
    .map((candidate, index) =>
      JSON.stringify({
        rank: index + 1,
        attempt: candidate.attempt,
        seed: candidate.seed,
        boardHash: candidate.boardHash,
        score: candidate.score,
        pathLength: candidate.path.length,
        visited: candidate.visited,
        metrics: candidate.metrics,
        profile: candidate.profile,
        proofPath: candidate.path,
        board: candidate.board,
      }),
    )
    .join("\n");
  writeFileSync(join(outDir, "deals.txt"), dealLines ? `${dealLines}\n` : "");
  writeFileSync(join(outDir, "manifest.jsonl"), manifestLines ? `${manifestLines}\n` : "");
  writeFileSync(
    join(outDir, "summary.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        options: {
          seed: options.seed,
          attempts: options.attempts,
          targetCount: options.targetCount,
          maxVisited: options.maxVisited,
          beam: options.beam,
          trimEvery: options.trimEvery,
          chunkSize: options.chunkSize ?? 100,
        },
        workers: workerCount,
        completedChunks,
        totalMs,
        counters,
        retainedCount: retained.length,
        bestScore: retained[0]?.score ?? null,
        worstRetainedScore: retained[retained.length - 1]?.score ?? null,
      },
      null,
      2,
    )}\n`,
  );
}

function printProgress(input: {
  completedAttempts: number;
  totalAttempts: number;
  retained: number;
  targetCount: number;
  counters: SearchCounters;
  started: number;
  final?: boolean;
}): void {
  const elapsedSeconds = Math.max(0.001, (Date.now() - input.started) / 1000);
  const attemptsPerHour = Math.round((input.completedAttempts / elapsedSeconds) * 3600);
  const prefix = input.final ? "complete" : "progress";
  console.log(
    `${prefix}: attempts=${input.completedAttempts.toLocaleString()}/${input.totalAttempts.toLocaleString()} retained=${input.retained}/${input.targetCount} solver=${input.counters.solverAttempts.toLocaleString()} solved=${input.counters.solved.toLocaleString()} rate=${attemptsPerHour.toLocaleString()}/hour`,
  );
}

function validateOptions(options: StandaloneRandomReferenceOptions): void {
  assertPositiveInteger(options.attempts, "attempts");
  assertPositiveInteger(options.targetCount, "targetCount");
  assertPositiveInteger(options.maxVisited, "maxVisited");
  assertPositiveInteger(options.beam, "beam");
  assertPositiveInteger(options.trimEvery, "trimEvery");
  if (options.workers !== undefined) assertPositiveInteger(options.workers, "workers");
  if (options.chunkSize !== undefined) assertPositiveInteger(options.chunkSize, "chunkSize");
  if (options.workers !== undefined && options.workers > 128) throw new Error(`workers is too high: ${options.workers}`);
  if (options.targetCount > options.attempts) {
    throw new Error(`targetCount cannot exceed attempts: ${options.targetCount} > ${options.attempts}`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer: ${value}`);
  }
}
