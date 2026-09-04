import { Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { DeliveryAttemptDto } from "@lrc/contracts";
import { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";
import { CurrentPrincipal, RequireRoles, type AuthPrincipal } from "./auth/auth.js";

@Controller("deliveries")
export class DeliveriesController {
  constructor(private readonly workflow: ReleaseWorkflowService) {}

  @Post(":id/submit")
  @RequireRoles("ReleaseManager")
  submit(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<DeliveryAttemptDto> {
    return this.workflow.submitDelivery(id, principal);
  }

  @Post(":id/retry")
  @RequireRoles("ReleaseManager")
  retry(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<DeliveryAttemptDto> {
    return this.workflow.submitDelivery(id, principal);
  }
}
