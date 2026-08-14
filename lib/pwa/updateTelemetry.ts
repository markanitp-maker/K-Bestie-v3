export const PWA_SW_STATES = [
  "installing",
  "installed",
  "activating",
  "activated",
  "redundant",
] as const;
export type PwaSwState = (typeof PWA_SW_STATES)[number];

export const PWA_CHECK_TRIGGERS = [
  "mount_ready",
  "route_ready",
  "visibility_visible",
  "online",
  "interval_60m",
  "manual_retry",
  "external_controller_deferred",
  "mount",
  "route_change",
  "visible",
  "periodic",
  "manual",
  "stale_asset",
] as const;
export type PwaCheckTrigger = (typeof PWA_CHECK_TRIGGERS)[number];

export const PWA_UPDATE_REASONS = [
  "version_mismatch",
  "waiting_worker_present",
  "stale_asset_recovery",
  "manual_check",
  "background_poll",
] as const;
export type PwaUpdateReason = (typeof PWA_UPDATE_REASONS)[number];

export const PWA_UPDATE_PHASES = [
  "checking",
  "rechecking",
  "registration_updating",
  "installing",
  "install_ready",
  "consensus_preparing",
  "activating",
  "verifying_latest",
  "verifying_latest_handshake",
  "controller_changed",
  "reload_pending",
] as const;
export type PwaUpdatePhase = (typeof PWA_UPDATE_PHASES)[number];

export const PWA_STALE_SIGNATURES = [
  "chunk_load_failed",
  "css_chunk_failed",
  "dynamic_import_failed",
  "static_asset_404",
  "sw_controller_missing",
] as const;
export type PwaStaleSignature = (typeof PWA_STALE_SIGNATURES)[number];

export const PWA_RECOVERY_ACTIONS = [
  "soft_reload",
  "cache_purge_reload",
  "unregister_reload",
  "bypass_service_worker",
] as const;
export type PwaRecoveryAction = (typeof PWA_RECOVERY_ACTIONS)[number];

export const PWA_UPDATE_ERROR_CODES = [
  "network_error",
  "install_timeout",
  "redundant",
  "target_replaced",
  "identity_mismatch",
  "handshake_failed",
  "consensus_aborted",
  "storage_error",
  "rate_limited",
  "invalid_response",
  "unknown_error",
] as const;
export type PwaUpdateErrorCode = (typeof PWA_UPDATE_ERROR_CODES)[number];

export const PWA_UPDATE_EVENT_TYPES = [
  "pwa_update_available",
  "pwa_update_dismissed",
  "pwa_update_started",
  "pwa_update_failed",
  "pwa_update_success",
  "pwa_stale_client_detected",
  "pwa_stale_client_recovery_started",
  "pwa_stale_client_recovery_success",
  "pwa_stale_client_recovery_failed",
  "pwa_check_completed",
] as const;
export type PwaUpdateEventType = (typeof PWA_UPDATE_EVENT_TYPES)[number];

export interface PwaTelemetryMetadata {
  sw_state?: PwaSwState;
  trigger?: PwaCheckTrigger;
  reason?: PwaUpdateReason;
  phase?: PwaUpdatePhase;
  stale_signature?: PwaStaleSignature;
  recovery_action?: PwaRecoveryAction;
  error_code?: PwaUpdateErrorCode;
  retry_count?: number;
  attempt?: number;
  check_interval_ms?: number;
}

export interface PwaTelemetryPayload {
  event_id: string;
  event_type: PwaUpdateEventType;
  correlation_id: string;
  route: string;
  current_version?: string | null;
  latest_version?: string | null;
  error_code?: PwaUpdateErrorCode | null;
  metadata?: PwaTelemetryMetadata;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOP_LEVEL_ALLOWED_KEYS = new Set([
  "event_id",
  "event_type",
  "correlation_id",
  "route",
  "current_version",
  "latest_version",
  "error_code",
  "metadata",
]);

const SPOOFED_IDENTITY_KEYS = new Set([
  "user_id",
  "actor_id",
  "child_id",
  "family_id",
  "actor_type",
  "session_id",
]);

const METADATA_ALLOWED_KEYS = new Set([
  "sw_state",
  "trigger",
  "reason",
  "phase",
  "stale_signature",
  "recovery_action",
  "error_code",
  "retry_count",
  "attempt",
  "check_interval_ms",
]);

const ENUM_SETS = {
  sw_state: new Set<string>(PWA_SW_STATES),
  trigger: new Set<string>(PWA_CHECK_TRIGGERS),
  reason: new Set<string>(PWA_UPDATE_REASONS),
  phase: new Set<string>(PWA_UPDATE_PHASES),
  stale_signature: new Set<string>(PWA_STALE_SIGNATURES),
  recovery_action: new Set<string>(PWA_RECOVERY_ACTIONS),
  error_code: new Set<string>(PWA_UPDATE_ERROR_CODES),
  event_type: new Set<string>(PWA_UPDATE_EVENT_TYPES),
};

/**
 * Validates canonical ASCII absolute route only.
 * Rejects:
 * - non-ASCII / control chars / spaces
 * - double slashes //
 * - backslash \
 * - query ? / hash #
 * - protocol / absolute URLs (http://, javascript:, etc.)
 * - dot segments (/../, /./, /.., /.)
 * - percent-encoded delimiters/control/path separators (%2f, %5c, %3f, %23, %0a, %2e, %20, etc.)
 */
export function isValidCanonicalRoute(route: unknown): route is string {
  if (typeof route !== "string" || route.length === 0 || route.length > 256) {
    return false;
  }

  // Must start with '/'
  if (!route.startsWith("/")) {
    return false;
  }

  // Check ASCII range (only 0x21 to 0x7E, except forbidden chars)
  // No spaces, no controls (< 0x20 or == 0x7F)
  for (let i = 0; i < route.length; i++) {
    const code = route.charCodeAt(i);
    if (code <= 32 || code >= 127) {
      return false;
    }
  }

  // Reject consecutive slashes //
  if (route.includes("//")) {
    return false;
  }

  // Reject backslash \
  if (route.includes("\\")) {
    return false;
  }

  // Reject query ? or hash #
  if (route.includes("?") || route.includes("#")) {
    return false;
  }

  // Reject colon : (prevents scheme like /http:/ or /javascript:)
  if (route.includes(":")) {
    return false;
  }

  // Reject dot segments: /./, /../, ending with /. or /..
  if (
    route === "/." ||
    route === "/.." ||
    route.includes("/./") ||
    route.includes("/../") ||
    route.endsWith("/.") ||
    route.endsWith("/..")
  ) {
    return false;
  }

  // Reject percent-encoded control characters, delimiters, dot segments, whitespace
  // %00-%1F, %7F, %20, %2F (%2f), %5C (%5c), %3F (%3f), %23, %2E (%2e)
  const percentDangerousPattern =
    /%(?:0[0-9a-fA-F]|1[0-9a-fA-F]|7[fF]|20|2[fFeE]|5[cC]|3[fF]|23)/;
  if (percentDangerousPattern.test(route)) {
    return false;
  }

  return true;
}

export function validatePwaTelemetryMetadata(
  metadata: unknown,
): { ok: true; value: PwaTelemetryMetadata } | { ok: false; error: string } {
  if (metadata === undefined || metadata === null) {
    return { ok: true, value: {} };
  }

  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return { ok: false, error: "metadata must be a plain object" };
  }

  const record = metadata as Record<string, unknown>;
  const normalized: PwaTelemetryMetadata = {};

  for (const [key, value] of Object.entries(record)) {
    if (!METADATA_ALLOWED_KEYS.has(key)) {
      return { ok: false, error: `Unknown metadata key: ${key}` };
    }

    if (value === undefined || value === null) {
      continue;
    }

    // No nested objects or arrays
    if (typeof value === "object") {
      return { ok: false, error: `Nested metadata not allowed for key: ${key}` };
    }

    if (typeof value === "number") {
      if (Number.isNaN(value) || !Number.isFinite(value)) {
        return { ok: false, error: `Invalid number for key: ${key}` };
      }
      if (!Number.isInteger(value)) {
        return { ok: false, error: `Non-integer number for key: ${key}` };
      }

      if (key === "retry_count" || key === "attempt") {
        if (value < 0 || value > 10) {
          return { ok: false, error: `${key} must be an integer 0..10` };
        }
        normalized[key] = value;
      } else if (key === "check_interval_ms") {
        if (value < 0 || value > 86400000) {
          return {
            ok: false,
            error: "check_interval_ms must be an integer 0..86400000",
          };
        }
        normalized[key] = value;
      } else {
        return { ok: false, error: `Unexpected numeric key: ${key}` };
      }
      continue;
    }

    if (typeof value === "string") {
      if (
        key === "retry_count" ||
        key === "attempt" ||
        key === "check_interval_ms"
      ) {
        return { ok: false, error: `Key ${key} must be a number, got string` };
      }

      const enumSet = ENUM_SETS[key as keyof typeof ENUM_SETS];
      if (!enumSet || !enumSet.has(value)) {
        return { ok: false, error: `Invalid enum value '${value}' for key: ${key}` };
      }

      (normalized as Record<string, unknown>)[key] = value;
      continue;
    }

    // Any other type (boolean, symbol, etc.)
    return { ok: false, error: `Invalid type '${typeof value}' for key: ${key}` };
  }

  return { ok: true, value: normalized };
}

const SAFE_VERSION_REGEX = /^[a-zA-Z0-9._\-:]{1,64}$/;

export function validatePwaTelemetryBody(
  body: unknown,
): { ok: true; value: PwaTelemetryPayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }

  const record = body as Record<string, unknown>;

  // Check for spoofed keys or unknown keys
  for (const key of Object.keys(record)) {
    if (SPOOFED_IDENTITY_KEYS.has(key)) {
      return { ok: false, error: `Client identity spoofing key rejected: ${key}` };
    }
    if (!TOP_LEVEL_ALLOWED_KEYS.has(key)) {
      return { ok: false, error: `Unknown top-level key: ${key}` };
    }
  }

  // event_id: required UUID
  if (typeof record.event_id !== "string" || !UUID_REGEX.test(record.event_id)) {
    return { ok: false, error: "event_id must be a valid UUID string" };
  }

  // event_type: required enum
  if (
    typeof record.event_type !== "string" ||
    !ENUM_SETS.event_type.has(record.event_type)
  ) {
    return { ok: false, error: `Invalid event_type: ${String(record.event_type)}` };
  }

  // correlation_id: required UUID
  if (
    typeof record.correlation_id !== "string" ||
    !UUID_REGEX.test(record.correlation_id)
  ) {
    return { ok: false, error: "correlation_id must be a valid UUID string" };
  }

  // route: required canonical route
  if (!isValidCanonicalRoute(record.route)) {
    return { ok: false, error: "route must be a valid canonical ASCII absolute path" };
  }

  // current_version: optional string <= 64 matching safe pattern
  if (
    record.current_version !== undefined &&
    record.current_version !== null &&
    (typeof record.current_version !== "string" ||
      !SAFE_VERSION_REGEX.test(record.current_version))
  ) {
    return { ok: false, error: "current_version must be a valid version string up to 64 chars" };
  }

  // latest_version: optional string <= 64 matching safe pattern
  if (
    record.latest_version !== undefined &&
    record.latest_version !== null &&
    (typeof record.latest_version !== "string" ||
      !SAFE_VERSION_REGEX.test(record.latest_version))
  ) {
    return { ok: false, error: "latest_version must be a valid version string up to 64 chars" };
  }

  // error_code: optional enum in PWA_UPDATE_ERROR_CODES
  if (
    record.error_code !== undefined &&
    record.error_code !== null &&
    (typeof record.error_code !== "string" ||
      !ENUM_SETS.error_code.has(record.error_code))
  ) {
    return { ok: false, error: `Invalid error_code enum value: ${String(record.error_code)}` };
  }

  // metadata: optional object
  const metadataValidation = validatePwaTelemetryMetadata(record.metadata);
  if (!metadataValidation.ok) {
    return { ok: false, error: metadataValidation.error };
  }

  // Check for conflicting top-level and metadata error_code
  if (
    record.error_code !== undefined &&
    record.error_code !== null &&
    metadataValidation.value.error_code !== undefined &&
    metadataValidation.value.error_code !== null &&
    record.error_code !== metadataValidation.value.error_code
  ) {
    return {
      ok: false,
      error: "Conflicting top-level error_code and metadata.error_code",
    };
  }

  const effectiveErrorCode =
    (record.error_code as PwaUpdateErrorCode | undefined) ??
    metadataValidation.value.error_code ??
    null;

  const payload: PwaTelemetryPayload = {
    event_id: record.event_id,
    event_type: record.event_type as PwaUpdateEventType,
    correlation_id: record.correlation_id,
    route: record.route,
    current_version: (record.current_version as string | undefined) ?? null,
    latest_version: (record.latest_version as string | undefined) ?? null,
    error_code: effectiveErrorCode,
    metadata: metadataValidation.value,
  };

  return { ok: true, value: payload };
}

/**
 * Client-side helper for safely emitting PWA update telemetry.
 * Normalizes metadata/payload and fails silently without throwing.
 */
export async function sendPwaUpdateTelemetry(
  payload: PwaTelemetryPayload,
): Promise<boolean> {
  try {
    const validation = validatePwaTelemetryBody(payload);
    if (!validation.ok) {
      return false;
    }

    const response = await fetch("/api/analytics/pwa-update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validation.value),
    });

    return response.ok;
  } catch {
    return false;
  }
}
