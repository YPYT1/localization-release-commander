import { Controller, Headers, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { DeliveryAttemptDto } from "@lrc/contracts";
import { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";

@Controller("deliveries")
export class DeliveriesController {
  constructor(private readonly workflow: ReleaseWorkflowService) {}

  @Post(":id/submit")
  submit(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Headers("x-actor-id") actor = "demo-operator",
  ): Promise<DeliveryAttemptDto> {
    return this.workflow.submitDelivery(id, actor);
  }

  @Post(":id/retry")
  retry(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Headers("x-actor-id") actor = "demo-operator",
  ): Promise<DeliveryAttemptDto> {
    return this.workflow.submitDelivery(id, actor);
  }
}
