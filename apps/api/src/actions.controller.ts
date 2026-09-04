import { Body, Controller, Headers, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { ActionDto, ApprovalDto } from "@lrc/contracts";
import { DtoValidationPipe, parseDecision, type DecisionInput } from "./dto-validation.js";
import { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";

@Controller("actions")
export class ActionsController {
  constructor(private readonly workflow: ReleaseWorkflowService) {}

  @Post(":id/execute")
  execute(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Headers("x-actor-id") actor = "demo-operator",
  ): Promise<ActionDto> {
    return this.workflow.executeAction(id, actor);
  }

  @Post(":id/approve")
  approve(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(parseDecision)) input: DecisionInput,
    @Headers("x-actor-id") actor = "demo-operator",
  ): Promise<ApprovalDto> {
    return this.workflow.decideAction(id, "APPROVED", input.reason, actor);
  }

  @Post(":id/reject")
  reject(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(parseDecision)) input: DecisionInput,
    @Headers("x-actor-id") actor = "demo-operator",
  ): Promise<ApprovalDto> {
    return this.workflow.decideAction(id, "REJECTED", input.reason, actor);
  }
}
