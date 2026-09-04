import assert from "node:assert/strict";
import test from "node:test";
import { FfprobeService, type CommandRunner } from "./storage/media-inspection.service.js";

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
