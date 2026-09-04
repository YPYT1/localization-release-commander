import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AssetDto, CreateReleaseInput, ReleaseDetailDto, ReleaseSummaryDto } from "@lrc/contracts";
import { RELEASE_REPOSITORY, type ReleaseRepository } from "./domain/repository.js";
import type { ValidatedAssetInput } from "./dto-validation.js";

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

  async getRelease(id: string): Promise<ReleaseDetailDto> {
    const release = await this.repository.getRelease(id);
    if (!release) throw new NotFoundException("Release not found");
    return release;
  }

  async addAsset(releaseId: string, input: ValidatedAssetInput): Promise<AssetDto> {
    if (!(await this.repository.getReleaseRecord(releaseId))) throw new NotFoundException("Release not found");
    const sha256 = input.sha256 ?? createHash("sha256").update(input.content ?? "", "utf8").digest("hex");
    const existing = await this.repository.findAssetByHash(releaseId, sha256);
    if (existing) return existing;

    const asset = await this.repository.createAsset(releaseId, {
      ...input,
      sha256,
      uri: input.uri ?? `asset://${sha256}`,
    });
    await this.repository.appendAudit({
      releaseId,
      type: "asset.created",
      actor: "system",
      payload: { assetId: asset.id, kind: asset.kind, fileName: asset.fileName, sha256 },
    });
    return asset;
  }
}
