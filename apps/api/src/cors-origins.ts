const DEFAULT_CORS_ORIGINS = "http://localhost:3000";

export function resolveCorsOrigins(value = process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS): string[] {
  const values = value.split(",").map((origin) => origin.trim());
  if (!values.length || values.some((origin) => !origin)) throw new Error("CORS_ORIGINS must contain one or more origins");
  return [...new Set(values.map((value) => normalizeOrigin(value)))];
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CORS_ORIGINS contains an invalid origin");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("CORS_ORIGINS values must be exact HTTP(S) origins");
  }
  return url.origin;
}
