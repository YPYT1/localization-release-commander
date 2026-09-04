import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
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
import { AUTH_SECRET, AuthGuard, AuthTokenService, loadAuthSecret } from "./auth/auth.js";
import { ProjectAccessService } from "./auth/project-access.service.js";

@Module({
  controllers: [HealthController, ReleasesController, ReadModelController, ActionsController, DeliveriesController],
  providers: [
    ReleaseService,
    ReleaseWorkflowService,
    DeterministicOrchestrationService,
    AuthTokenService,
    ProjectAccessService,
    { provide: AUTH_SECRET, useFactory: loadAuthSecret },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: ORCHESTRATION_SERVICE, useExisting: DeterministicOrchestrationService },
    { provide: RELEASE_REPOSITORY, useFactory: () => createReleaseRepository(process.env.DATABASE_URL) },
  ],
})
export class AppModule {}
