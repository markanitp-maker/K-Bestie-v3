export interface DocumentDeploymentMarkerV1 {
  schemaVersion: 1;
  buildId: string;
  buildStamp: string;
  deploymentId: string;
}

export interface PwaGateHistoryStateV1 {
  schemaVersion: 1;
  gateToken: string;
  originalUrl: string;
}

const PWA_GATE_HISTORY_ALLOWED_KEYS = [
  "schemaVersion",
  "gateToken",
  "originalUrl",
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePwaGateHistoryState(
  raw: unknown,
): PwaGateHistoryStateV1 | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(obj, PWA_GATE_HISTORY_ALLOWED_KEYS)) return null;
  if (obj.schemaVersion !== 1) return null;
  if (typeof obj.gateToken !== "string" || !UUID_PATTERN.test(obj.gateToken)) {
    return null;
  }
  if (
    typeof obj.originalUrl !== "string" ||
    !obj.originalUrl.startsWith("/") ||
    obj.originalUrl.startsWith("//") ||
    /[\u0000-\u001f\u007f]/.test(obj.originalUrl)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    gateToken: obj.gateToken,
    originalUrl: obj.originalUrl,
  };
}

export function createPwaGateHistoryState(
  gateToken: string,
  originalUrl: string,
): PwaGateHistoryStateV1 | null {
  return parsePwaGateHistoryState({
    schemaVersion: 1,
    gateToken,
    originalUrl,
  });
}

export function isOwnedPwaGateHistoryState(
  raw: unknown,
  gateToken: string,
): boolean {
  const parsed = parsePwaGateHistoryState(raw);
  return parsed !== null && parsed.gateToken === gateToken;
}

export const DOCUMENT_DEPLOYMENT_META_NAME = "kbestie-document-deployment-v1";

const DOCUMENT_DEPLOYMENT_ALLOWED_KEYS = [
  "schemaVersion",
  "buildId",
  "buildStamp",
  "deploymentId",
] as const;

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

function isSafeStringValue(val: unknown): val is string {
  if (typeof val !== "string") return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return false;
  if (/[?#%]/.test(trimmed)) return false;
  return true;
}

/**
 * Strict parser for DocumentDeploymentMarkerV1.
 */
export function parseDocumentDeploymentMarker(raw: unknown): DocumentDeploymentMarkerV1 | null {
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
  if (!hasOnlyAllowedKeys(obj, DOCUMENT_DEPLOYMENT_ALLOWED_KEYS)) {
    return null;
  }

  if (obj.schemaVersion !== 1) {
    return null;
  }

  if (!isSafeStringValue(obj.buildId)) return null;
  if (!isSafeStringValue(obj.buildStamp)) return null;
  if (!isSafeStringValue(obj.deploymentId)) return null;

  return {
    schemaVersion: 1,
    buildId: obj.buildId.trim(),
    buildStamp: obj.buildStamp.trim(),
    deploymentId: obj.deploymentId.trim(),
  };
}

/**
 * Serializes a DocumentDeploymentMarkerV1 to a JSON string for meta tag content.
 */
export function serializeDocumentDeploymentMarker(marker: DocumentDeploymentMarkerV1): string {
  const validated = parseDocumentDeploymentMarker(marker);
  if (!validated) {
    throw new Error("Invalid DocumentDeploymentMarkerV1 cannot be serialized");
  }
  return JSON.stringify(validated);
}

/**
 * Reads DocumentDeploymentMarkerV1 from the DOM.
 * Fails closed if missing, duplicated, empty, or malformed.
 */
export function getDocumentDeploymentMarker(
  doc?: { querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null }> } | null,
): DocumentDeploymentMarkerV1 | null {
  try {
    const targetDoc =
      doc ?? (typeof document !== "undefined" ? document : null);
    if (!targetDoc) return null;

    const elements = targetDoc.querySelectorAll(
      `meta[name="${DOCUMENT_DEPLOYMENT_META_NAME}"]`,
    );

    // Strict constraint: Exactly 1 meta tag must exist!
    if (!elements || elements.length !== 1) {
      return null;
    }

    const content = elements[0].getAttribute("content");
    if (!content || !content.trim()) {
      return null;
    }

    return parseDocumentDeploymentMarker(content);
  } catch {
    return null;
  }
}
