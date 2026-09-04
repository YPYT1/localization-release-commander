import type { Platform } from "@lrc/contracts";

export interface RuleSetDefinition {
  id: string;
  name: string;
  version: string;
  platform: Platform;
  language: string;
  status: "PUBLISHED";
  checks: number;
  updatedAt: string;
}

const updatedAt = "2026-09-04T00:00:00.000Z";

export const RULE_SETS: readonly RuleSetDefinition[] = [
  { id: "youtube-en-v1", name: "YouTube English Delivery", version: "1.0.0", platform: "YOUTUBE", language: "en", status: "PUBLISHED", checks: 8, updatedAt },
  { id: "youtube-ja-v1", name: "YouTube Japanese Delivery", version: "1.0.0", platform: "YOUTUBE", language: "ja", status: "PUBLISHED", checks: 8, updatedAt },
  { id: "youtube-es-v1", name: "YouTube Spanish Delivery", version: "1.0.0", platform: "YOUTUBE", language: "es", status: "PUBLISHED", checks: 8, updatedAt },
  { id: "ott-en-v1", name: "OTT English Delivery", version: "1.0.0", platform: "OTT", language: "en", status: "PUBLISHED", checks: 10, updatedAt },
  { id: "ott-ja-v1", name: "OTT Japanese Delivery", version: "1.0.0", platform: "OTT", language: "ja", status: "PUBLISHED", checks: 10, updatedAt },
  { id: "ott-es-v1", name: "OTT Spanish Delivery", version: "1.0.0", platform: "OTT", language: "es", status: "PUBLISHED", checks: 10, updatedAt },
];

export const getRuleSet = (id: string): RuleSetDefinition | undefined => RULE_SETS.find((ruleSet) => ruleSet.id === id);
