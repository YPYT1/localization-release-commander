import { hostname } from "node:os";
import { processNextEvaluation } from "./api-worker.js";

async function main(): Promise<void> {
  const apiUrl = process.env.WORKER_API_URL;
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!apiUrl || !secret) {
    console.info(JSON.stringify({ worker: "ready", mode: "idle", reason: "WORKER_API_URL and WORKER_SHARED_SECRET are required for polling" }));
    return;
  }
  const workerId = process.env.WORKER_ID ?? `lrc-worker-${hostname()}-${process.pid}`;
  console.info(JSON.stringify({ worker: "ready", mode: "polling", workerId }));
  for (;;) {
    const completed = await processNextEvaluation({ apiUrl, secret, workerId });
    await new Promise((resolve) => setTimeout(resolve, completed ? 0 : 1_000));
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Worker failed");
  process.exitCode = 1;
});
