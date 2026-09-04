import { Controller, Get } from "@nestjs/common";
import type { HealthDto } from "@lrc/contracts";

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthDto {
    return { service: "api", status: "ok", timestamp: new Date().toISOString() };
  }
}
