import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open as openFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, PayloadTooLargeException } from "@nestjs/common";

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const OBJECT_URI = /^asset:\/\/objects\/([0-9a-f]{2})\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.asset$/;

export interface AssetStorageOptions {
  rootDir?: string;
  maxBytes?: number;
}

export interface StoredAssetObject {
  uri: string;
  sha256: string;
  sizeBytes: number;
  path: string;
}

export interface OpenedAssetObject {
  path: string;
  sizeBytes: number;
  stream: ReturnType<Awaited<ReturnType<typeof openFile>>["createReadStream"]>;
}

export const ASSET_STORAGE_OPTIONS = Symbol("ASSET_STORAGE_OPTIONS");

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function resolveAssetStorageRoot(configured = process.env.ASSET_STORAGE_DIR): string {
  if (configured) {
    if (process.env.NODE_ENV === "production" && !isAbsolute(configured)) throw new Error("ASSET_STORAGE_DIR must be absolute in production");
    return resolve(configured);
  }
  if (process.env.NODE_ENV === "production") throw new Error("ASSET_STORAGE_DIR is required in production");
  const cwd = process.cwd();
  const projectRoot = basename(cwd).toLowerCase() === "api" && basename(dirname(cwd)).toLowerCase() === "apps"
    ? resolve(cwd, "../..")
    : cwd;
  return resolve(projectRoot, "data/assets");
}

export function resolveAssetMaxBytes(configured = process.env.ASSET_MAX_BYTES): number {
  return positiveInteger(configured, DEFAULT_MAX_BYTES, "ASSET_MAX_BYTES");
}

export function resolveAssetIncomingDirectory(configured = process.env.ASSET_STORAGE_DIR): string {
  return resolve(resolveAssetStorageRoot(configured), ".incoming");
}

@Injectable()
export class AssetStorageService {
  readonly rootDir: string;
  readonly incomingDir: string;
  readonly maxBytes: number;

  constructor(
    @Optional() @Inject(ASSET_STORAGE_OPTIONS) options: AssetStorageOptions = {},
  ) {
    this.rootDir = resolve(options.rootDir ?? resolveAssetStorageRoot());
    this.incomingDir = resolve(this.rootDir, ".incoming");
    this.maxBytes = options.maxBytes ?? resolveAssetMaxBytes();
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0) throw new Error("asset maxBytes must be a positive integer");
  }

  async storeContent(content: Buffer | string): Promise<StoredAssetObject> {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    this.assertSize(bytes.byteLength);
    await mkdir(this.incomingDir, { recursive: true });
    const temporaryPath = resolve(this.incomingDir, `${randomUUID()}.part`);
    try {
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      return await this.adoptTemporaryFile(temporaryPath);
    } catch (error) {
      await this.discardTemporaryFile(temporaryPath);
      throw error;
    }
  }

  async adoptTemporaryFile(temporaryPath: string): Promise<StoredAssetObject> {
    const safeTemporaryPath = this.safeTemporaryPath(temporaryPath);
    let moved = false;
    try {
      const stats = await lstat(safeTemporaryPath);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new BadRequestException("Uploaded asset must be a regular file");
      this.assertSize(stats.size);

      const handle = await openFile(safeTemporaryPath, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }

      const sha256 = await this.hashFile(safeTemporaryPath);
      const objectId = randomUUID();
      const shard = objectId.slice(0, 2);
      const objectPath = resolve(this.rootDir, "objects", shard, `${objectId}.asset`);
      await mkdir(dirname(objectPath), { recursive: true });
      await rename(safeTemporaryPath, objectPath);
      moved = true;
      return {
        uri: `asset://objects/${shard}/${objectId}.asset`,
        sha256,
        sizeBytes: stats.size,
        path: objectPath,
      };
    } finally {
      if (!moved) await this.discardTemporaryFile(safeTemporaryPath);
    }
  }

  async open(uri: string): Promise<OpenedAssetObject> {
    const path = this.pathFromUri(uri);
    let handle: Awaited<ReturnType<typeof openFile>> | undefined;
    try {
      const pathStats = await lstat(path);
      if (!pathStats.isFile() || pathStats.isSymbolicLink()) throw new NotFoundException("Asset content not found");
      handle = await openFile(path, "r");
      const handleStats = await handle.stat();
      if (!handleStats.isFile() || pathStats.dev !== handleStats.dev || pathStats.ino !== handleStats.ino) {
        await handle.close();
        throw new NotFoundException("Asset content not found");
      }
      return { path, sizeBytes: handleStats.size, stream: handle.createReadStream({ autoClose: true }) };
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      if (isNodeError(error) && error.code === "ENOENT") throw new NotFoundException("Asset content not found");
      throw error;
    }
  }

  async read(uri: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of (await this.open(uri)).stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async remove(uri: string): Promise<void> {
    await rm(this.pathFromUri(uri), { force: true });
  }

  async discardTemporaryFile(temporaryPath?: string): Promise<void> {
    if (!temporaryPath) return;
    let safePath: string;
    try {
      safePath = this.safeTemporaryPath(temporaryPath);
    } catch {
      return;
    }
    await rm(safePath, { force: true });
  }

  private assertSize(sizeBytes: number): void {
    if (sizeBytes <= 0) throw new BadRequestException("Asset content cannot be empty");
    if (sizeBytes > this.maxBytes) throw new PayloadTooLargeException(`Asset exceeds the ${this.maxBytes} byte limit`);
  }

  private safeTemporaryPath(path: string): string {
    const candidate = resolve(path);
    if (!this.isInside(candidate, this.incomingDir)) throw new BadRequestException("Invalid temporary asset path");
    return candidate;
  }

  private pathFromUri(uri: string): string {
    const match = OBJECT_URI.exec(uri);
    if (!match) throw new BadRequestException("Invalid asset storage URI");
    const [, shard, objectId] = match;
    const candidate = resolve(this.rootDir, "objects", shard!, `${objectId!}.asset`);
    const objectsDir = resolve(this.rootDir, "objects");
    if (!this.isInside(candidate, objectsDir)) throw new BadRequestException("Invalid asset storage URI");
    return candidate;
  }

  private isInside(candidate: string, parent: string): boolean {
    const base = resolve(parent);
    return candidate.startsWith(`${base}${sep}`);
  }

  private async hashFile(path: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest("hex");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
