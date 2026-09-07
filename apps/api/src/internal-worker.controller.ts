import { BadRequestException, Body, Controller, Headers, Inject, Post } from "@nestjs/common";
import { Public } from "./auth/auth.js";
import { RELEASE_REPOSITORY, type ReleaseRepository } from "./domain/repository.js";
import { requireWorkerToken } from "./worker-auth.js";
import { DeterministicOrchestrationService } from "./workflow/orchestration.js";
import { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";
import type { ReleaseEvaluationResult } from "@lrc/worker";

@Controller("internal/worker")
@Public()
export class InternalWorkerController {
  constructor(
    @Inject(RELEASE_REPOSITORY) private readonly repository: ReleaseRepository,
    private readonly orchestration: DeterministicOrchestrationService,
    private readonly workflow: ReleaseWorkflowService,
  ) {}

  @Post("claim")
  async claim(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { workerId?: unknown },
  ): Promise<{ run: { id: string; attempt: number; input: unknown } | null }> {
    requireWorkerToken(authorization);
    const workerId = typeof body?.workerId === "string" ? body.workerId.trim() : "";
    if (!workerId || workerId.length > 120) throw new BadRequestException("workerId is required");
    const now = new Date();
    const run = await this.repository.claimNextWorkflowRun(
      "EVALUATE_RELEASE",
      workerId,
      new Date(now.getTime() + 60_000).toISOString(),
      now.toISOString(),
    );
    if (!run) return { run: null };
    const release = await this.repository.getRelease(run.releaseId);
    if (!release) throw new BadRequestException("Release not found");
    return { run: { id: run.id, attempt: run.attempt, input: await this.orchestration.prepareEvaluation(release) } };
  }

  @Post("complete")
  async complete(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { workerId?: unknown; runId?: unknown; attempt?: unknown; result?: unknown },
  ) {
    requireWorkerToken(authorization);
    const workerId = typeof body?.workerId === "string" ? body.workerId.trim() : "";
    const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    if (!workerId || !runId || !Number.isInteger(body?.attempt) || !body.result || typeof body.result !== "object" || Array.isArray(body.result)) {
      throw new BadRequestException("workerId, runId, attempt and result are required");
    }
    return this.workflow.completeWorkerEvaluation(runId, workerId, body.attempt as number, body.result as ReleaseEvaluationResult);
  }
}
