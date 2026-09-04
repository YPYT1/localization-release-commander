export interface YouTubeDeliveryCommand {
  platform: "YOUTUBE";
  releaseId: string;
  video: {
    videoId: string;
    title: string;
    description: string;
    privacyStatus: "private" | "unlisted" | "public";
  };
  caption: {
    videoId: string;
    language: string;
    name: string;
    isDraft: boolean;
    mediaContent: string;
  };
}

export interface OttDeliveryCommand {
  platform: "OTT";
  releaseId: string;
  packageId: string;
  locale: string;
  manifest: Record<string, unknown>;
}

export type DeliveryCommand = YouTubeDeliveryCommand | OttDeliveryCommand;
export type SimulatedSubmitOutcome = "SUCCESS" | "TIMEOUT_AFTER_ACCEPT" | "FAILURE";
export type SimulatedQcOutcome = "PASSED" | "FAILED";

export type DeliverySubmitResult =
  | { status: "SUBMITTED"; providerRequestId: string; idempotencyKey: string }
  | { status: "FAILED"; code: string; message: string; idempotencyKey: string };

export interface DeliveryQcResult {
  status: SimulatedQcOutcome;
  providerRequestId: string;
  code?: string;
}

export interface PlatformAdapter {
  submit(command: DeliveryCommand, idempotencyKey: string): Promise<DeliverySubmitResult>;
  recover(idempotencyKey: string): Promise<DeliverySubmitResult | undefined>;
  poll(providerRequestId: string): Promise<DeliveryQcResult>;
}

export class DeliveryTimeoutError extends Error {
  constructor(readonly idempotencyKey: string) {
    super("Platform submission timed out after the request was accepted");
    this.name = "DeliveryTimeoutError";
  }
}

function required(value: string, field: string): void {
  if (!value.trim()) throw new TypeError(`${field} is required`);
}

export function validateDeliveryCommand(command: DeliveryCommand): void {
  required(command.releaseId, "releaseId");
  if (command.platform === "YOUTUBE") {
    required(command.video.videoId, "video.videoId");
    required(command.video.title, "video.title");
    required(command.caption.videoId, "caption.videoId");
    required(command.caption.language, "caption.language");
    required(command.caption.name, "caption.name");
    required(command.caption.mediaContent, "caption.mediaContent");
    if (command.video.videoId !== command.caption.videoId) throw new TypeError("caption.videoId must match video.videoId");
    if (!["private", "unlisted", "public"].includes(command.video.privacyStatus)) throw new TypeError("invalid video.privacyStatus");
    return;
  }
  required(command.packageId, "packageId");
  required(command.locale, "locale");
}

function captionTrackKey(command: YouTubeDeliveryCommand): string {
  return `${command.caption.videoId}:${command.caption.language}:${command.caption.name}`;
}

export class DeterministicPlatformAdapter implements PlatformAdapter {
  externalSubmitCount = 0;
  recoverCount = 0;

  private readonly records = new Map<string, DeliverySubmitResult>();
  private readonly qcByRequest = new Map<string, SimulatedQcOutcome>();
  private readonly captionTracks = new Set<string>();

  constructor(private readonly plan: {
    submitOutcomes?: readonly SimulatedSubmitOutcome[];
    qcOutcomes?: readonly SimulatedQcOutcome[];
  } = {}) {}

  async submit(command: DeliveryCommand, idempotencyKey: string): Promise<DeliverySubmitResult> {
    validateDeliveryCommand(command);
    required(idempotencyKey, "idempotencyKey");
    const recorded = this.records.get(idempotencyKey);
    if (recorded) return recorded;

    if (command.platform === "YOUTUBE" && this.captionTracks.has(captionTrackKey(command))) {
      return { status: "FAILED", code: "CAPTION_TRACK_CONFLICT", message: "A caption with this video, language, and name already exists", idempotencyKey };
    }

    const attempt = this.externalSubmitCount++;
    const outcome = this.plan.submitOutcomes?.[attempt] ?? "SUCCESS";
    if (outcome === "FAILURE") {
      return { status: "FAILED", code: "PLATFORM_REJECTED", message: "Deterministic platform rejection", idempotencyKey };
    }

    const providerRequestId = `${command.platform.toLowerCase()}-request-${String(attempt + 1).padStart(4, "0")}`;
    const result: DeliverySubmitResult = { status: "SUBMITTED", providerRequestId, idempotencyKey };
    this.records.set(idempotencyKey, result);
    this.qcByRequest.set(providerRequestId, this.plan.qcOutcomes?.[attempt] ?? "PASSED");
    if (command.platform === "YOUTUBE") this.captionTracks.add(captionTrackKey(command));
    if (outcome === "TIMEOUT_AFTER_ACCEPT") throw new DeliveryTimeoutError(idempotencyKey);
    return result;
  }

  async recover(idempotencyKey: string): Promise<DeliverySubmitResult | undefined> {
    this.recoverCount += 1;
    return this.records.get(idempotencyKey);
  }

  async poll(providerRequestId: string): Promise<DeliveryQcResult> {
    const status = this.qcByRequest.get(providerRequestId);
    if (!status) throw new Error(`Unknown provider request id: ${providerRequestId}`);
    return {
      status,
      providerRequestId,
      ...(status === "FAILED" ? { code: "PLATFORM_QC_FAILED" } : {}),
    };
  }
}
