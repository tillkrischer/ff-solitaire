import { parentPort } from "node:worker_threads";
import { runWorkerChunk, type WorkerChunkRequest } from "./core.ts";

if (!parentPort) {
  throw new Error("standalone random reference worker must be run as a worker thread");
}

const port = parentPort;

port.on("message", (message: WorkerChunkRequest | { stop: true }) => {
  if ("stop" in message) {
    port.close();
    return;
  }
  port.postMessage(runWorkerChunk(message));
});
