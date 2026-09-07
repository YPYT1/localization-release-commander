import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AssetInspectionService, FfprobeService, type CommandRunner } from "./storage/media-inspection.service.js";

test("ffprobe inspection uses an argument array, timeout, and normalized metadata", async () => {
  const calls: Array<{ executable: string; args: readonly string[]; options: Parameters<CommandRunner["execFile"]>[2] }> = [];
  const runner: CommandRunner = {
    async execFile(executable, args, options) {
      calls.push({ executable, args, options });
      return {
        stdout: JSON.stringify({
          format: { format_name: "mov,mp4", duration: "1.250", bit_rate: "64000" },
          streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 320, height: 180 }],
        }),
      };
    },
  };
  const service = new FfprobeService(runner, { executable: "ffprobe-test", timeoutMs: 4321 });

  const metadata = await service.inspect("D:\\storage\\object.asset", "VIDEO");

  assert.deepEqual(calls, [{
    executable: "ffprobe-test",
    args: ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "D:\\storage\\object.asset"],
    options: { timeout: 4321, maxBuffer: 4_194_304, windowsHide: true, shell: false },
  }]);
  assert.deepEqual(metadata, {
    formatName: "mov,mp4",
    durationMs: 1250,
    bitRate: 64000,
    streams: [{ index: 0, type: "video", codec: "h264", width: 320, height: 180 }],
  });
});

test("ffprobe inspection rejects media without the requested stream kind", async () => {
  const runner: CommandRunner = {
    async execFile() {
      return { stdout: JSON.stringify({ format: { format_name: "wav" }, streams: [{ index: 0, codec_type: "audio", codec_name: "pcm_s16le" }] }) };
    },
  };
  const service = new FfprobeService(runner, { executable: "ffprobe-test", timeoutMs: 1000 });
  await assert.rejects(service.inspect("D:\\storage\\audio.asset", "VIDEO"), /does not contain a video stream/);
});

test("ffprobe inspection reports missing binaries and timeouts as service failures", async () => {
  for (const error of [Object.assign(new Error("missing"), { code: "ENOENT" }), Object.assign(new Error("timeout"), { killed: true })]) {
    const runner: CommandRunner = { async execFile() { throw error; } };
    const service = new FfprobeService(runner, { executable: "ffprobe-test", timeoutMs: 1000 });
    await assert.rejects(service.inspect("D:\\storage\\video.asset", "VIDEO"), (caught: unknown) => {
      return typeof caught === "object" && caught !== null && "getStatus" in caught
        && typeof caught.getStatus === "function" && caught.getStatus() === 503;
    });
  }
});

test("structured inspection records SRT format and derives rights only from a valid time window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lrc-inspection-"));
  const service = new AssetInspectionService(new FfprobeService({ async execFile() { throw new Error("unused"); } }, {}));
  try {
    const subtitlePath = join(directory, "subtitle.srt");
    await writeFile(subtitlePath, "1\n00:00:00,000 --> 00:00:01,000\nHello\n", "utf8");
    const subtitle = await service.inspect({ path: subtitlePath, kind: "SUBTITLE", fileName: "subtitle.srt", language: "en", sizeBytes: 44 });
    assert.deepEqual(subtitle.subtitle, { format: "SRT", valid: true, cueCount: 1, durationMs: 1000, findings: [] });

    const rightsPath = join(directory, "rights.json");
    const validWindow = JSON.stringify({ validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-12-31T00:00:00.000Z" });
    await writeFile(rightsPath, validWindow, "utf8");
    const rights = await service.inspect({ path: rightsPath, kind: "RIGHTS", fileName: "rights.json", sizeBytes: Buffer.byteLength(validWindow) });
    assert.equal(rights.validFrom, "2026-01-01T00:00:00.000Z");
    assert.equal(rights.validUntil, "2026-12-31T00:00:00.000Z");

    for (const invalid of [
      { status: "VALID" },
      { validFrom: "2026-01-01", validUntil: "2026-12-31T00:00:00.000Z" },
      { validFrom: "2026-12-31T00:00:00.000Z", validUntil: "2026-01-01T00:00:00.000Z" },
    ]) {
      const content = JSON.stringify(invalid);
      await writeFile(rightsPath, content, "utf8");
      await assert.rejects(
        service.inspect({ path: rightsPath, kind: "RIGHTS", fileName: "rights.json", sizeBytes: Buffer.byteLength(content) }),
        /RIGHTS/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
