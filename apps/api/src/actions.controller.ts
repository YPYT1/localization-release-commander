import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { ActionDto, ApprovalDto } from "@lrc/contracts";
import { DtoValidationPipe, parseDecision, type DecisionInput } from "./dto-validation.js";
import { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";
import { CurrentPrincipal, RequireRoles, type AuthPrincipal } from "./auth/auth.js";

@Controller("actions")
export class ActionsController {
  constructor(private readonly workflow: ReleaseWorkflowService) {}

  @Post(":id/execute")
  @RequireRoles("Operator")
  execute(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<ActionDto> {
    return this.workflow.executeAction(id, principal);
  }

  @Post(":id/approve")
  @RequireRoles("Approver")
  approve(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(parseDecision)) input: DecisionInput,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<ApprovalDto> {
    return this.workflow.decideAction(id, "APPROVED", input.reason, principal);
  }

  @Post(":id/reject")
  @RequireRoles("Approver")
  reject(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(parseDecision)) input: DecisionInput,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<ApprovalDto> {
    return this.workflow.decideAction(id, "REJECTED", input.reason, principal);
  }
}
