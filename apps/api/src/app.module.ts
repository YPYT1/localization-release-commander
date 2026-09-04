import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { RELEASE_REPOSITORY } from "./domain/repository.js";
import { createReleaseRepository } from "./storage/repository.factory.js";
import { ReleasesController } from "./releases.controller.js";
import { ReleaseService } from "./release.service.js";
import { ReadModelController } from "./read-model.controller.js";
import { ActionsController } from "./actions.controller.js";
import { DeliveriesController } from "./deliveries.controller.js";
import { DeterministicOrchestrationService, ORCHESTRATION_SERVICE } from "./workflow/orchestration.js";
import { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";

@Module({
  controllers: [HealthController, ReleasesController, ReadModelController, ActionsController, DeliveriesController],
  providers: [
    ReleaseService,
    ReleaseWorkflowService,
    DeterministicOrchestrationService,
    { provide: ORCHESTRATION_SERVICE, useExisting: DeterministicOrchestrationService },
    { provide: RELEASE_REPOSITORY, useFactory: () => createReleaseRepository(process.env.DATABASE_URL) },
  ],
})
export class AppModule {}
