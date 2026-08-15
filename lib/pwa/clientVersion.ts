// Bump this value only when an installed client must reload before entering a Mission.
// A source-controlled value works for Git and CLI Vercel deployments alike.
export const PWA_CLIENT_VERSION = "2026-08-14.2";

export interface LatestVersionMetadataV1 {
  schemaVersion: 1;
  buildId: string;
  buildStamp: string;
  deploymentId: string;
  swVersion: string;
  serviceWorkerScriptUrl: string;
}

export type LatestVersionFetchErrorCode =
  | "network"
  | "timeout"
  | "http"
  | "redirect"
  | "media"
  | "oversize"
  | "malformed"
  | "invalid-schema";

export type LatestVersionFetchResult =
  | { ok: true; snapshot: Readonly<LatestVersionMetadataV1> }
  | { ok: false; code: LatestVersionFetchErrorCode };

export interface FetchLatestVersionOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export const LATEST_VERSION_ENDPOINT = "/api/client-version";
export const LATEST_VERSION_FETCH_TIMEOUT_MS = 3_000;
export const LATEST_VERSION_MAX_BYTES = 16 * 1024;

const LATEST_VERSION_ALLOWED_KEYS = [
  "schemaVersion",
  "buildId",
  "buildStamp",
  "deploymentId",
  "swVersion",
  "serviceWorkerScriptUrl",
] as const;

/**
 * Checks that an object only contains the allowed keys.
 */
function hasOnlyAllowedKeys<T extends string>(
  obj: Record<string, unknown>,
  allowedKeys: readonly T[],
): boolean {
  const allowedSet = new Set<string>(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Validates that a string does not contain control characters, encoded delimiters, query, or hash.
 */
function isSafeStringValue(val: unknown): val is string {
  if (typeof val !== "string") return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  // Reject control chars, whitespace inside critical IDs if any, query, hash
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return false;
  if (/[?#%]/.test(trimmed)) return false;
  return true;
}

/**
 * Validates a same-origin canonical service worker script pathname.
 * Must start with `/`, not `//`, no domain/protocol, no `\`, no dot segments (`/../`, `/./`), no percent encoding.
 */
export function isCanonicalScriptPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return false;
  if (trimmed.includes("\\")) return false;
  if (trimmed.includes("?") || trimmed.includes("#") || trimmed.includes("%")) return false;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return false;
  // Reject dot segments: /../, /./, trailing /.. or /.
  if (/(?:^|\/)\.\.?(?:\/|$)/.test(trimmed)) return false;
  return true;
}

/**
 * Normalizes a script URL to its canonical pathname.
 */
export function normalizeScriptUrlPath(url: string | undefined | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    return parsed.pathname;
  } catch {
    return url.trim();
  }
}

/**
 * Strict parser for LatestVersionMetadataV1.
 * Rejects unknown keys, empty strings, invalid script URLs, wrong schema versions.
 */
export function parseLatestVersionMetadata(raw: unknown): LatestVersionMetadataV1 | null {
  if (!raw) return null;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(obj, LATEST_VERSION_ALLOWED_KEYS)) {
    return null;
  }

  if (obj.schemaVersion !== 1) {
    return null;
  }

  if (!isSafeStringValue(obj.buildId)) return null;
  if (!isSafeStringValue(obj.buildStamp)) return null;
  if (!isSafeStringValue(obj.deploymentId)) return null;
  if (!isSafeStringValue(obj.swVersion)) return null;
  if (!isCanonicalScriptPath(obj.serviceWorkerScriptUrl)) return null;

  return {
    schemaVersion: 1,
    buildId: obj.buildId.trim(),
    buildStamp: obj.buildStamp.trim(),
    deploymentId: obj.deploymentId.trim(),
    swVersion: obj.swVersion.trim(),
    serviceWorkerScriptUrl: obj.serviceWorkerScriptUrl.trim(),
  };
}

export function areLatestVersionMetadataEqual(
  left: Readonly<LatestVersionMetadataV1> | null | undefined,
  right: Readonly<LatestVersionMetadataV1> | null | undefined,
): boolean {
  return Boolean(
    left &&
      right &&
      left.schemaVersion === right.schemaVersion &&
      left.buildId === right.buildId &&
      left.buildStamp === right.buildStamp &&
      left.deploymentId === right.deploymentId &&
      left.swVersion === right.swVersion &&
      left.serviceWorkerScriptUrl === right.serviceWorkerScriptUrl,
  );
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false };
  }

  if (!response.body) {
    const bodyText = await response.text();
    if (new TextEncoder().encode(bodyText).byteLength > maxBytes) {
      return { ok: false };
    }
    return { ok: true, text: bodyText };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
}

/** Fetches and freezes one complete, strict latest-version snapshot. */
export async function fetchLatestVersionMetadataV1(
  options: FetchLatestVersionOptions = {},
): Promise<LatestVersionFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? LATEST_VERSION_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? LATEST_VERSION_MAX_BYTES;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(LATEST_VERSION_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
      },
      signal: controller.signal,
    });

    if (
      response.redirected ||
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    ) {
      return { ok: false, code: "redirect" };
    }

    if (response.url && typeof window !== "undefined") {
      const finalUrl = new URL(response.url, window.location.origin);
      if (
        finalUrl.origin !== window.location.origin ||
        finalUrl.pathname !== LATEST_VERSION_ENDPOINT ||
        finalUrl.search ||
        finalUrl.hash
      ) {
        return { ok: false, code: "redirect" };
      }
    }

    if (!response.ok) return { ok: false, code: "http" };

    const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (mediaType !== "application/json") {
      return { ok: false, code: "media" };
    }

    let body: { ok: true; text: string } | { ok: false };
    try {
      body = await readBoundedResponseBody(response, maxBytes);
    } catch {
      return timedOut
        ? { ok: false, code: "timeout" }
        : { ok: false, code: "malformed" };
    }
    if (!body.ok) return { ok: false, code: "oversize" };

    let raw: unknown;
    try {
      raw = JSON.parse(body.text);
    } catch {
      return { ok: false, code: "malformed" };
    }

    const parsed = parseLatestVersionMetadata(raw);
    if (!parsed) return { ok: false, code: "invalid-schema" };

    return { ok: true, snapshot: Object.freeze({ ...parsed }) };
  } catch {
    return timedOut
      ? { ok: false, code: "timeout" }
      : { ok: false, code: "network" };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Strict serializer for LatestVersionMetadataV1.
 */
export function serializeLatestVersionMetadata(metadata: LatestVersionMetadataV1): string {
  const validated = parseLatestVersionMetadata(metadata);
  if (!validated) {
    throw new Error("Invalid LatestVersionMetadataV1 cannot be serialized");
  }
  return JSON.stringify(validated);
}
