import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ActionDto, DeliveryAttemptDto, ReleaseDetailDto } from "@lrc/contracts";
import { RELEASE_REPOSITORY, type ReleaseRecord, type ReleaseRepository } from "../domain/repository.js";
import type { AuthPrincipal } from "./auth.js";

@Injectable()
export class ProjectAccessService {
  constructor(@Inject(RELEASE_REPOSITORY) private readonly repository: ReleaseRepository) {}

  projectFilter(principal: AuthPrincipal): readonly string[] | undefined {
    return principal.roles.includes("Admin") ? undefined : principal.projectIds;
  }

  assertProject(principal: AuthPrincipal, projectId: string): void {
    if (!principal.roles.includes("Admin") && !principal.projectIds.includes(projectId)) {
      throw new ForbiddenException("Project access denied");
    }
  }

  async requireReleaseRecord(principal: AuthPrincipal, releaseId: string): Promise<ReleaseRecord> {
    const release = await this.repository.getReleaseRecord(releaseId);
    if (!release) throw new NotFoundException("Release not found");
    this.assertProject(principal, release.projectId);
    return release;
  }

  async requireRelease(principal: AuthPrincipal, releaseId: string): Promise<ReleaseDetailDto> {
    const release = await this.repository.getRelease(releaseId);
    if (!release) throw new NotFoundException("Release not found");
    this.assertProject(principal, release.projectId);
    return release;
  }

  async requireAction(principal: AuthPrincipal, actionId: string): Promise<{ action: ActionDto; release: ReleaseDetailDto }> {
    const action = await this.repository.getAction(actionId);
    if (!action) throw new NotFoundException("Action not found");
    return { action, release: await this.requireRelease(principal, action.releaseId) };
  }

  async requireDelivery(principal: AuthPrincipal, deliveryId: string): Promise<{ delivery: DeliveryAttemptDto; release: ReleaseDetailDto }> {
    const delivery = await this.repository.getDelivery(deliveryId);
    if (!delivery) throw new NotFoundException("Delivery not found");
    return { delivery, release: await this.requireRelease(principal, delivery.releaseId) };
  }
}
