import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { HealthDto } from "@lrc/contracts";
import { Public } from "./auth/auth.js";
import { RELEASE_REPOSITORY, type ReleaseRepository } from "./domain/repository.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(RELEASE_REPOSITORY) private readonly repository: ReleaseRepository) {}

  @Get()
  @Public()
  getHealth(): HealthDto {
    return { service: "api", status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  @Public()
  async getReady(): Promise<HealthDto> {
    try {
      await this.repository.healthCheck();
      return this.getHealth();
    } catch {
      throw new ServiceUnavailableException("Storage is unavailable");
    }
  }
}
