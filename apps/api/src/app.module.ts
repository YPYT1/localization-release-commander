import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { RELEASE_REPOSITORY } from "./domain/repository.js";
import { InMemoryReleaseRepository } from "./storage/in-memory.repository.js";
import { ReleasesController } from "./releases.controller.js";
import { ReleaseService } from "./release.service.js";
import { ReadModelController } from "./read-model.controller.js";

@Module({
  controllers: [HealthController, ReleasesController, ReadModelController],
  providers: [ReleaseService, { provide: RELEASE_REPOSITORY, useFactory: () => new InMemoryReleaseRepository() }],
})
export class AppModule {}
