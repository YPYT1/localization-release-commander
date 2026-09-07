import { evaluateRelease, type ReleaseEvaluationInput } from "./release-evaluation.js";

export interface ApiWorkerConfig {
  apiUrl: string;
  secret: string;
  workerId: string;
  fetch?: typeof globalThis.fetch;
}

interface ClaimedRun {
  id: string;
  attempt: number;
  input: ReleaseEvaluationInput;
}

export async function processNextEvaluation(config: ApiWorkerConfig): Promise<boolean> {
  const request = config.fetch ?? globalThis.fetch;
  const headers = { authorization: `Bearer ${config.secret}`, "content-type": "application/json" };
  const claim = await request(`${config.apiUrl.replace(/\/$/, "")}/internal/worker/claim`, {
    method: "POST", headers, body: JSON.stringify({ workerId: config.workerId }),
  });
  if (!claim.ok) throw new Error(`Worker claim failed: ${claim.status}`);
  const body = await claim.json() as { run: ClaimedRun | null };
  if (!body.run) return false;
  const result = await evaluateRelease(body.run.input);
  const complete = await request(`${config.apiUrl.replace(/\/$/, "")}/internal/worker/complete`, {
    method: "POST", headers, body: JSON.stringify({ workerId: config.workerId, runId: body.run.id, attempt: body.run.attempt, result }),
  });
  if (!complete.ok) throw new Error(`Worker completion failed: ${complete.status} ${await complete.text()}`);
  return true;
}
