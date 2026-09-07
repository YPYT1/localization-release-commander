import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { MulterModule } from "@nestjs/platform-express";
import { mkdir } from "node:fs/promises";
import { HealthController } from "./health.controller.js";
import { RELEASE_REPOSITORY } from "./domain/repository.js";
import { createReleaseRepository } from "./storage/repository.factory.js";
import { ReleasesController } from "./releases.controller.js";
import { ReleaseService } from "./release.service.js";
import { ReadModelController } from "./read-model.controller.js";
import { ActionsController } from "./actions.controller.js";
import { DeliveriesController } from "./deliveries.controller.js";
import { DeterministicOrchestrationService, ORCHESTRATION_CLOCK, ORCHESTRATION_SERVICE } from "./workflow/orchestration.js";
import { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";
import { AUTH_SECRET, AuthGuard, AuthTokenService, loadAuthSecret } from "./auth/auth.js";
import { ProjectAccessService } from "./auth/project-access.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AssetsController } from "./assets.controller.js";
import { AssetStorageService, resolveAssetIncomingDirectory, resolveAssetMaxBytes } from "./storage/asset-storage.service.js";
import { AssetInspectionService, FFPROBE_RUNNER, FfprobeService, nodeCommandRunner } from "./storage/media-inspection.service.js";
import { AssetService } from "./asset.service.js";
import { UploadAssetGuard } from "./upload-asset.guard.js";
import { ApiExceptionFilter } from "./api-exception.filter.js";

@Module({
  imports: [
    MulterModule.registerAsync({
      useFactory: async () => {
        const dest = resolveAssetIncomingDirectory();
        await mkdir(dest, { recursive: true });
        return {
          dest,
          preservePath: false,
          limits: { fileSize: resolveAssetMaxBytes(), files: 1, fields: 4, parts: 5, fieldSize: 65_536 },
        };
      },
    }),
  ],
  controllers: [HealthController, AuthController, ReleasesController, AssetsController, ReadModelController, ActionsController, DeliveriesController],
  providers: [
    ReleaseService,
    ReleaseWorkflowService,
    DeterministicOrchestrationService,
    AuthTokenService,
    ProjectAccessService,
    AssetService,
    UploadAssetGuard,
    AssetStorageService,
    AssetInspectionService,
    FfprobeService,
    { provide: FFPROBE_RUNNER, useValue: nodeCommandRunner },
    { provide: AUTH_SECRET, useFactory: loadAuthSecret },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: ORCHESTRATION_CLOCK, useValue: () => new Date().toISOString() },
    { provide: ORCHESTRATION_SERVICE, useExisting: DeterministicOrchestrationService },
    { provide: RELEASE_REPOSITORY, useFactory: () => createReleaseRepository(process.env.DATABASE_URL) },
  ],
})
export class AppModule {}
