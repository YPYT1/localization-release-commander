import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateReleaseInput, ReleaseSummaryDto } from "@lrc/contracts";
import { RELEASE_REPOSITORY, type ReleaseRepository } from "./domain/repository.js";

@Injectable()
export class ReleaseService {
  constructor(@Inject(RELEASE_REPOSITORY) private readonly repository: ReleaseRepository) {}

  async createRelease(input: CreateReleaseInput): Promise<ReleaseSummaryDto> {
    const project = input.projectId
      ? await this.repository.getProject(input.projectId)
      : await this.repository.createProject(input.projectName ?? "Demo Studio");
    if (!project) throw new NotFoundException("Project not found");

    const release = await this.repository.createRelease({ ...input, projectId: project.id });
    await this.repository.appendAudit({
      releaseId: release.id,
      type: "release.created",
      actor: "system",
      payload: { projectId: project.id, version: release.version },
    });
    const { id, episode, territory, platform, language, state, updatedAt } = release;
    return { id, episode, territory, platform, language, state, updatedAt };
  }

  listReleases(projectId?: string): Promise<ReleaseSummaryDto[]> {
    return this.repository.listReleases(projectId);
  }
}
