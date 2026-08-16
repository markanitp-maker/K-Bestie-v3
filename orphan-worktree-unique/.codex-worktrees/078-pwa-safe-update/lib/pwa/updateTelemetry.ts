export const PWA_UPDATE_EVENT_TYPES = [
  "pwa_update_check_started",
  "pwa_update_check_no_update",
  "pwa_update_available",
  "pwa_update_modal_shown",
  "pwa_update_clicked",
  "pwa_update_activation_started",
  "pwa_update_success",
  "pwa_update_failed",
  "pwa_update_gate_blocked_navigation",
  "pwa_stale_client_detected",
  "pwa_stale_client_recovery_started",
  "pwa_stale_client_recovery_success",
  "pwa_stale_client_recovery_failed",
] as const;

export type PwaUpdateEventType = (typeof PWA_UPDATE_EVENT_TYPES)[number];

const PWA_UPDATE_EVENTS_SET = new Set<string>(PWA_UPDATE_EVENT_TYPES);

export function isPwaUpdateEventType(value: unknown): value is PwaUpdateEventType {
  return typeof value === "string" && PWA_UPDATE_EVENTS_SET.has(value);
}

const CORRELATION_STORAGE_KEY = "k_pwa_update_correlation_id";
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreatePwaCorrelationId(
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof sessionStorage !== "undefined"
    ? sessionStorage
    : null,
): string {
  if (!storage) {
    return generateUuid();
  }
  try {
    const existing = storage.getItem(CORRELATION_STORAGE_KEY);
    if (existing && UUID_REGEX.test(existing)) {
      return existing;
    }
    const newId = generateUuid();
    storage.setItem(CORRELATION_STORAGE_KEY, newId);
    return newId;
  } catch {
    return generateUuid();
  }
}

export interface PwaTelemetryOptions {
  eventId?: string;
  eventType: PwaUpdateEventType;
  route?: string;
  currentVersion?: string;
  latestVersion?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  storageImpl?: Pick<Storage, "getItem" | "setItem"> | null;
}

function truncateString(str: string | undefined, maxLength: number): string | undefined {
  if (!str) return undefined;
  const trimmed = str.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

export function sanitizeRoutePath(rawRoute: string | undefined): string {
  if (!rawRoute) return "/";
  // Strip query string, fragment, and control characters
  const clean = rawRoute.split("?")[0].split("#")[0].replace(/[\x00-\x1F\x7F]/g, "").trim();
  if (!clean.startsWith("/")) return "/";
  return clean.length > 256 ? clean.slice(0, 256) : clean;
}

const SAFE_METADATA_KEYS = new Set([
  "sw_state",
  "retry_count",
  "trigger",
  "reason",
  "phase",
  "check_interval_ms",
  "stale_signature",
  "recovery_action",
  "attempt",
]);

const FORBIDDEN_IDENTITY_KEYS = new Set([
  "user_id",
  "actor_id",
  "child_id",
  "family_id",
  "actor_type",
  "session_id",
]);

export function sanitizeMetadata(
  meta: Record<string, unknown> | undefined
): Record<string, string | number | boolean> | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, val] of Object.entries(meta)) {
    if (FORBIDDEN_IDENTITY_KEYS.has(key)) {
      continue;
    }
    if (SAFE_METADATA_KEYS.has(key)) {
      if (typeof val === "boolean") {
        clean[key] = val;
      } else if (typeof val === "number") {
        if (Number.isFinite(val)) {
          clean[key] = val;
        }
      } else if (typeof val === "string") {
        clean[key] = val.length > 64 ? val.slice(0, 64) : val;
      }
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * Fail-open client telemetry sender.
 * Client contract: event_id UUID required, exactly 13 allowed event types, correlation UUID,
 * template-safe route, strict version/error/metadata allowlists/enums/ranges; no identity fields, no raw errors.
 */
export async function sendPwaUpdateTelemetry(
  options: PwaTelemetryOptions,
): Promise<void> {
  const {
    eventId: rawEventId,
    eventType,
    route,
    currentVersion,
    latestVersion,
    errorCode,
    metadata,
    fetchImpl = typeof fetch !== "undefined" ? fetch : undefined,
    storageImpl,
  } = options;

  if (!isPwaUpdateEventType(eventType) || !fetchImpl) {
    return;
  }

  try {
    const eventId = rawEventId && UUID_REGEX.test(rawEventId) ? rawEventId : generateUuid();
    const correlationId = getOrCreatePwaCorrelationId(storageImpl);

    const rawRoute = route || (typeof window !== "undefined" ? window.location.pathname : "/");
    const safeRoute = sanitizeRoutePath(rawRoute);
    const safeCurrentVersion = truncateString(currentVersion, 64);
    const safeLatestVersion = truncateString(latestVersion, 64);
    const safeErrorCode = truncateString(errorCode, 64);
    const safeMetadata = sanitizeMetadata(metadata);

    const bodyPayload = {
      event_id: eventId,
      event_type: eventType,
      correlation_id: correlationId,
      route: safeRoute,
      current_version: safeCurrentVersion,
      latest_version: safeLatestVersion,
      error_code: safeErrorCode,
      metadata: safeMetadata,
    };

    const response = await fetchImpl("/api/analytics/pwa-update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      console.warn("[pwaTelemetry] failed to send telemetry:", response.status);
    }
  } catch (error) {
    console.warn("[pwaTelemetry] network error sending telemetry:", error);
  }
}
