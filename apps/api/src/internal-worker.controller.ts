import { BadRequestException, Body, Controller, Headers, Inject, Post } from "@nestjs/common";
import { Public } from "./auth/auth.js";
import { RELEASE_REPOSITORY, type ReleaseRepository, type WorkflowRunRecord } from "./domain/repository.js";
import { requireWorkerToken } from "./worker-auth.js";

@Controller("internal/worker")
@Public()
export class InternalWorkerController {
  constructor(@Inject(RELEASE_REPOSITORY) private readonly repository: ReleaseRepository) {}

  @Post("claim")
  async claim(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { workerId?: unknown },
  ): Promise<{ run: WorkflowRunRecord | null }> {
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
    return { run: run ?? null };
  }
}
