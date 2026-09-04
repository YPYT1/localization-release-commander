import { basename } from "node:path";
import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { AssetDto, AssetKind } from "@lrc/contracts";
import type { AuthPrincipal } from "./auth/auth.js";
import { ProjectAccessService } from "./auth/project-access.service.js";
import {
  AssetRegistrationUncertainError,
  isAssetMutableState,
  RELEASE_REPOSITORY,
  type AssetRegistrationResult,
  type ReleaseRecord,
  type ReleaseRepository,
} from "./domain/repository.js";
import { parseUploadAsset, type ValidatedAssetInput } from "./dto-validation.js";
import { AssetStorageService, type StoredAssetObject } from "./storage/asset-storage.service.js";
import { AssetInspectionService } from "./storage/media-inspection.service.js";

interface UploadedAssetFile {
  originalname: string;
  mimetype: string;
  path: string;
  size: number;
}

interface PersistAssetInput {
  kind: AssetKind;
  language?: string;
  fileName: string;
  metadata?: Record<string, unknown>;
  reportedContentType?: string;
  parentAssetId?: string;
}

@Injectable()
export class AssetService {
  constructor(
    @Inject(RELEASE_REPOSITORY) private readonly repository: ReleaseRepository,
    private readonly access: ProjectAccessService,
    private readonly storage: AssetStorageService,
    private readonly inspection: AssetInspectionService,
  ) {}

  async addContent(releaseId: string, input: ValidatedAssetInput, principal: AuthPrincipal): Promise<AssetDto> {
    const release = await this.access.requireReleaseRecord(principal, releaseId);
    this.assertAssetsMutable(release);
    const fileName = this.fileName(input.fileName);
    const stored = await this.storage.storeContent(input.content);
    return this.persist(releaseId, {
      kind: input.kind,
      language: input.language,
      fileName,
      metadata: input.metadata,
    }, stored, principal);
  }

  async addUpload(releaseId: string, body: unknown, rawFile: unknown, principal: AuthPrincipal): Promise<AssetDto> {
    const file = this.uploadedFile(rawFile);
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(releaseId)) {
        throw new BadRequestException("release id must be a UUID v4");
      }
      let input: ReturnType<typeof parseUploadAsset>;
      try {
        input = parseUploadAsset(body);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "Invalid multipart fields");
      }
      const release = await this.access.requireReleaseRecord(principal, releaseId);
      this.assertAssetsMutable(release);
      const fileName = this.fileName(file.originalname);
      const stored = await this.storage.adoptTemporaryFile(file.path);
      return await this.persist(releaseId, {
        ...input,
        fileName,
        reportedContentType: file.mimetype,
      }, stored, principal);
    } finally {
      await this.storage.discardTemporaryFile(file.path);
    }
  }

  async addDerived(
    releaseId: string,
    input: Omit<PersistAssetInput, "reportedContentType"> & { content: string | Buffer; parentAssetId: string },
    principal: AuthPrincipal,
  ): Promise<AssetDto> {
    const release = await this.access.requireReleaseRecord(principal, releaseId);
    this.assertAssetsMutable(release);
    const parent = await this.repository.getAsset(input.parentAssetId);
    if (!parent || parent.releaseId !== releaseId) throw new BadRequestException("parentAssetId must reference an asset in this release");
    const fileName = this.fileName(input.fileName);
    const stored = await this.storage.storeContent(input.content);
    return this.persist(releaseId, { ...input, fileName }, stored, principal);
  }

  async openAuthorized(assetId: string, principal: AuthPrincipal) {
    const { asset } = await this.access.requireAsset(principal, assetId);
    const opened = await this.storage.open(asset.uri);
    return {
      stream: opened.stream,
      sizeBytes: opened.sizeBytes,
      fileName: asset.fileName,
      contentType: this.contentType(asset.metadata.contentType),
    };
  }

  private async persist(releaseId: string, input: PersistAssetInput, stored: StoredAssetObject, principal: AuthPrincipal): Promise<AssetDto> {
    let inspection: Record<string, unknown>;
    try {
      inspection = await this.inspection.inspect({
        path: stored.path,
        kind: input.kind,
        fileName: input.fileName,
        language: input.language,
        sizeBytes: stored.sizeBytes,
        reportedContentType: input.reportedContentType,
      });
    } catch (error) {
      await this.storage.remove(stored.uri);
      throw error;
    }

    let result: AssetRegistrationResult;
    try {
      result = await this.repository.registerAsset({
        releaseId,
        parentAssetId: input.parentAssetId ?? null,
        kind: input.kind,
        language: input.language,
        fileName: input.fileName,
        uri: stored.uri,
        sha256: stored.sha256,
        metadata: {
          ...this.externalMetadata(input.metadata),
          originalFileName: input.fileName,
          ...inspection,
        },
      }, { actor: principal.id, sizeBytes: stored.sizeBytes });
    } catch (error) {
      if (!(error instanceof AssetRegistrationUncertainError)) await this.storage.remove(stored.uri);
      throw error;
    }
    if (result.outcome === "not_mutable") {
      await this.storage.remove(stored.uri);
      throw new ConflictException(`Assets cannot be changed while release is ${result.state}`);
    }
    if (result.outcome === "existing") {
      await this.storage.remove(stored.uri);
      return result.asset;
    }
    return result.asset;
  }

  private assertAssetsMutable(release: ReleaseRecord): void {
    if (!isAssetMutableState(release.state)) {
      throw new ConflictException(`Assets cannot be changed while release is ${release.state}`);
    }
  }

  private uploadedFile(value: unknown): UploadedAssetFile {
    if (!value || typeof value !== "object") throw new BadRequestException("file is required");
    const file = value as Partial<UploadedAssetFile>;
    if (typeof file.originalname !== "string" || typeof file.mimetype !== "string" || typeof file.path !== "string" || typeof file.size !== "number") {
      throw new BadRequestException("file is invalid");
    }
    return file as UploadedAssetFile;
  }

  private fileName(value: string): string {
    const normalized = basename(value.replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!normalized) throw new BadRequestException("fileName is required");
    return normalized.slice(0, 255);
  }

  private contentType(value: unknown): string {
    const safe = new Set([
      "application/json", "application/octet-stream", "application/x-subrip", "application/zip",
      "audio/flac", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav",
      "image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm",
    ]);
    return typeof value === "string" && safe.has(value) ? value : "application/octet-stream";
  }

  private externalMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
    const reserved = new Set([
      "contentType", "jsonKeys", "media", "originalFileName", "parentAssetId", "sha256", "sizeBytes", "status", "subtitle", "uri", "validFrom", "validUntil",
    ]);
    return Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => !reserved.has(key)));
  }
}
