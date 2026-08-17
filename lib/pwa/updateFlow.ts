import {
  isValidUuid,
  hasOnlyAllowedKeys,
  requestServiceWorkerIdentity,
  ServiceWorkerIdentity,
} from "./swProtocol";
import {
  LatestVersionMetadataV1,
  parseLatestVersionMetadata,
  normalizeScriptUrlPath,
} from "./clientVersion";
import {
  DocumentDeploymentMarkerV1,
  parseDocumentDeploymentMarker,
} from "./documentDeployment";

export const PWA_ACTIVATION_DELAY_MS = 8_000;
export const PWA_DISMISS_COOLDOWN_MS = 10 * 60 * 1_000;
export const RELOAD_PENDING_MARKER_KEY = "k_pwa_reload_pending_v3";
export const RELOAD_PENDING_MARKER_TTL_MS = 60_000;

export type UpdateWorkerAction =
  | "message_waiting"
  | "wait_for_transition"
  | "refresh_registration";

type WorkerState = ServiceWorkerState | null | undefined;

export function isPwaDismissCooldownActive(
  dismissedAt: number,
  now = Date.now(),
): boolean {
  return dismissedAt > 0 && now - dismissedAt < PWA_DISMISS_COOLDOWN_MS;
}

export function decideUpdateWorkerAction(input: {
  waitingState?: WorkerState;
  installingState?: WorkerState;
  rememberedState?: WorkerState;
}): UpdateWorkerAction {
  if (input.waitingState === "installed") return "message_waiting";
  if (
    ["installing", "installed", "activating"].includes(
      input.installingState ?? "",
    )
  ) {
    return "wait_for_transition";
  }
  if (input.rememberedState === "installed") return "message_waiting";
  if (
    input.rememberedState === "installing" ||
    input.rememberedState === "activating"
  ) {
    return "wait_for_transition";
  }
  return "refresh_registration";
}

export function canDismissPwaModal(pwaState: string): boolean {
  return pwaState === "offline" || pwaState === "delayed" || pwaState === "error";
}

export function pwaUpdateCopy(state: "delayed" | "offline" | "error") {
  if (state === "offline") {
    return {
      title: "인터넷 연결이 끊겨 있어 업데이트할 수 없어요.",
      body: "연결 후 다시 시도해 주세요. 현재 버전은 계속 사용할 수 있습니다.",
      action: "다시 확인",
    };
  }
  if (state === "delayed") {
    return {
      title: "새 버전 적용이 조금 늦어지고 있어요.",
      body: "현재 버전은 계속 사용할 수 있습니다.",
      action: "새로고침",
    };
  }
  return {
    title: "새 버전을 확인하지 못했어요.",
    body: "현재 버전은 계속 사용할 수 있습니다.",
    action: "새로고침",
  };
}

// -------------------------------------------------------------
// Explicit Registration Update & Target Verification
// -------------------------------------------------------------

export type RegistrationUpdateResult =
  | "invalid-target"
  | "no-update"
  | "installed-target"
  | "network-error"
  | "install-timeout"
  | "redundant"
  | "target-replaced"
  | "identity-mismatch";

export interface PerformRegistrationUpdateOptions {
  registration: ServiceWorkerRegistration;
  targetSnapshot?: Readonly<LatestVersionMetadataV1> | null;
  installTimeoutMs?: number;
}

export interface PerformRegistrationUpdateOutcome {
  result: RegistrationUpdateResult;
  worker?: ServiceWorker;
  identity?: ServiceWorkerIdentity;
  targetSnapshot?: Readonly<LatestVersionMetadataV1>;
}

function normalizeScriptUrl(url: string | undefined | null): string {
  return normalizeScriptUrlPath(url);
}

/**
 * Executes registration.update() and waits for the exact installing/waiting target.
 * Requires a complete and valid targetSnapshot before registration.update() is called.
 * Returns explicit status without swallowing errors.
 */
export async function performRegistrationUpdate(
  options: PerformRegistrationUpdateOptions,
): Promise<PerformRegistrationUpdateOutcome> {
  const {
    registration,
    targetSnapshot,
    installTimeoutMs = 10_000,
  } = options;

  // 0. Complete target is strictly required before registration.update()
  if (!targetSnapshot) {
    return { result: "invalid-target" };
  }

  const parsedTarget = parseLatestVersionMetadata(targetSnapshot);
  const validTarget = parsedTarget
    ? Object.freeze({ ...parsedTarget })
    : null;
  if (!validTarget) {
    return { result: "invalid-target" };
  }

  try {
    await registration.update();
  } catch {
    return { result: "network-error" };
  }

  // 1. If registration.waiting already exists and is installed
  if (registration.waiting && registration.waiting.state === "installed") {
    const worker = registration.waiting;
    if (
      normalizeScriptUrl(worker.scriptURL) !==
      normalizeScriptUrl(validTarget.serviceWorkerScriptUrl)
    ) {
      return { result: "identity-mismatch", worker };
    }

    const identity = await requestServiceWorkerIdentity(worker);
    if (
      !identity ||
      identity.protocolVersion !== 1 ||
      typeof identity.workerNonce !== "string" ||
      !identity.workerNonce.trim()
    ) {
      return { result: "identity-mismatch", worker };
    }
    if (
      identity.buildId !== validTarget.buildId ||
      identity.swVersion !== validTarget.swVersion
    ) {
      return { result: "identity-mismatch", worker, identity };
    }

    if (registration.waiting !== worker || worker.state !== "installed") {
      return { result: "target-replaced" };
    }

    return {
      result: "installed-target",
      worker,
      identity,
      targetSnapshot: validTarget,
    };
  }

  // 2. If registration.installing exists, wait for statechange to installed
  if (registration.installing) {
    const installingTarget = registration.installing;

    const waitOutcome = await new Promise<"installed" | "redundant" | "timeout">(
      (resolve) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve("timeout");
          }
        }, installTimeoutMs);

        const onStateChange = () => {
          if (settled) return;
          if (installingTarget.state === "installed") {
            settled = true;
            cleanup();
            resolve("installed");
          } else if (installingTarget.state === "redundant") {
            settled = true;
            cleanup();
            resolve("redundant");
          }
        };

        const cleanup = () => {
          clearTimeout(timeoutId);
          installingTarget.removeEventListener("statechange", onStateChange);
        };

        installingTarget.addEventListener("statechange", onStateChange);
        // Check current state immediately
        if (installingTarget.state === "installed") {
          settled = true;
          cleanup();
          resolve("installed");
        } else if (installingTarget.state === "redundant") {
          settled = true;
          cleanup();
          resolve("redundant");
        }
      },
    );

    if (waitOutcome === "redundant") {
      return { result: "redundant" };
    }
    if (waitOutcome === "timeout") {
      return { result: "install-timeout" };
    }

    // Installing target transitioned to installed.
    // Allow bounded microtask/event settling for registration.waiting exact object
    if (registration.waiting !== installingTarget) {
      const settleDeadline = Date.now() + Math.min(1000, installTimeoutMs);
      while (registration.waiting !== installingTarget && Date.now() < settleDeadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    // Exact check: registration.waiting must be the exact installing target.
    if (registration.waiting !== installingTarget) {
      return { result: "target-replaced" };
    }

    const worker = registration.waiting;
    if (
      normalizeScriptUrl(worker.scriptURL) !==
      normalizeScriptUrl(validTarget.serviceWorkerScriptUrl)
    ) {
      return { result: "identity-mismatch", worker };
    }

    const identity = await requestServiceWorkerIdentity(worker);
    if (
      !identity ||
      identity.protocolVersion !== 1 ||
      typeof identity.workerNonce !== "string" ||
      !identity.workerNonce.trim()
    ) {
      return { result: "identity-mismatch", worker };
    }
    if (
      identity.buildId !== validTarget.buildId ||
      identity.swVersion !== validTarget.swVersion
    ) {
      return { result: "identity-mismatch", worker, identity };
    }

    if (registration.waiting !== worker || worker.state !== "installed") {
      return { result: "target-replaced" };
    }

    return {
      result: "installed-target",
      worker,
      identity,
      targetSnapshot: validTarget,
    };
  }

  // 3. Neither waiting nor installing found
  return { result: "no-update" };
}

// -------------------------------------------------------------
// Strict Marker Schema v3 & Transitional v2 Interfaces
// -------------------------------------------------------------

export interface ReloadPendingMarkerV3 {
  schemaVersion: 3;
  proposalId: string;
  target: LatestVersionMetadataV1;
  activationWorkerNonce: string;
  successEventId: string;
  documentBuildStampBeforeReload: string;
  startedAt: number;
  expiresAt: number;
  reason: string;
}

const MARKER_V3_ALLOWED_KEYS = [
  "schemaVersion",
  "proposalId",
  "target",
  "activationWorkerNonce",
  "successEventId",
  "documentBuildStampBeforeReload",
  "startedAt",
  "expiresAt",
  "reason",
] as const;

export function parseReloadPendingMarker(
  raw: unknown,
  now = Date.now(),
): ReloadPendingMarkerV3 | null {
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
  if (!hasOnlyAllowedKeys(obj, MARKER_V3_ALLOWED_KEYS)) {
    return null;
  }

  // V1 and V2 markers are strictly rejected (quarantined)
  if (obj.schemaVersion !== 3) {
    return null;
  }

  if (typeof obj.proposalId !== "string" || !isValidUuid(obj.proposalId)) {
    return null;
  }
  if (
    typeof obj.successEventId !== "string" ||
    !isValidUuid(obj.successEventId)
  ) {
    return null;
  }

  const target = parseLatestVersionMetadata(obj.target);
  if (!target) {
    return null;
  }

  if (
    typeof obj.activationWorkerNonce !== "string" ||
    !obj.activationWorkerNonce.trim()
  ) {
    return null;
  }
  if (
    typeof obj.documentBuildStampBeforeReload !== "string" ||
    !obj.documentBuildStampBeforeReload.trim()
  ) {
    return null;
  }
  if (typeof obj.reason !== "string" || !obj.reason.trim()) {
    return null;
  }

  if (
    typeof obj.startedAt !== "number" ||
    !Number.isFinite(obj.startedAt) ||
    obj.startedAt <= 0
  ) {
    return null;
  }
  if (
    typeof obj.expiresAt !== "number" ||
    !Number.isFinite(obj.expiresAt) ||
    obj.expiresAt <= obj.startedAt
  ) {
    return null;
  }

  if (now >= obj.expiresAt) {
    return null;
  }

  return {
    schemaVersion: 3,
    proposalId: obj.proposalId.trim(),
    target,
    activationWorkerNonce: obj.activationWorkerNonce.trim(),
    successEventId: obj.successEventId.trim(),
    documentBuildStampBeforeReload: obj.documentBuildStampBeforeReload.trim(),
    startedAt: obj.startedAt,
    expiresAt: obj.expiresAt,
    reason: obj.reason.trim(),
  };
}

export function saveReloadPendingMarker(
  marker: ReloadPendingMarkerV3,
  storage?: Storage,
): boolean {
  try {
    const s =
      storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
    if (!s) return false;
    const serialized = JSON.stringify(marker);
    s.setItem(RELOAD_PENDING_MARKER_KEY, serialized);
    const readBack = s.getItem(RELOAD_PENDING_MARKER_KEY);
    if (!readBack) return false;
    const validated = parseReloadPendingMarker(readBack, marker.startedAt);
    return validated !== null;
  } catch {
    return false;
  }
}

export function getReloadPendingMarker(
  storage?: Storage,
  now = Date.now(),
): ReloadPendingMarkerV3 | null {
  try {
    const s =
      storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
    if (!s) return null;

    // Quarantine and delete all stale legacy V1/V2 markers
    try {
      s.removeItem("k_pwa_reload_pending_v2");
      s.removeItem("k_pwa_reload_pending_v1");
    } catch {}

    const raw = s.getItem(RELOAD_PENDING_MARKER_KEY);
    if (!raw) return null;

    const parsed = parseReloadPendingMarker(raw, now);
    if (!parsed) {
      // Quarantine/delete invalid or expired marker
      s.removeItem(RELOAD_PENDING_MARKER_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearReloadPendingMarker(storage?: Storage): void {
  try {
    const s =
      storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
    if (!s) return;
    s.removeItem(RELOAD_PENDING_MARKER_KEY);
    s.removeItem("k_pwa_reload_pending_v2");
    s.removeItem("k_pwa_reload_pending_v1");
  } catch {}
}

// -------------------------------------------------------------
// Post-Reload Durable Identity & Latest Handshake
// -------------------------------------------------------------

export interface VerifyLatestHandshakeInput {
  marker: ReloadPendingMarkerV3;
  serverMetadata: Readonly<LatestVersionMetadataV1> | null;
  serverFetchError?: boolean;
  documentMarker?: DocumentDeploymentMarkerV1 | null;
  controllerIdentity: ServiceWorkerIdentity | null;
  controllerScriptUrl?: string | null;
}

export type VerifyLatestHandshakeResult =
  | { ok: true; status: "success" }
  | {
      ok: false;
      status:
        | "network_error"
        | "malformed"
        | "server_newer"
        | "mismatch"
        | "no_controller"
        | "legacy_controller";
      reason: string;
    };

/**
 * Pure verification function for post-reload latest handshake.
 *
 * Success requires:
 * 1. Server no-store LatestVersionMetadataV1 matches marker target.
 * 2. Document deployment marker and buildStamp matches marker target.
 * 3. Exact current controller fresh v1 identity (buildId, swVersion, scriptUrl) matches marker target.
 *
 * 5xx/malformed/no controller/legacy/mismatch retain gate+marker and only retry.
 */
export function verifyLatestHandshake(
  input: VerifyLatestHandshakeInput,
): VerifyLatestHandshakeResult {
  const {
    marker,
    serverMetadata,
    serverFetchError,
    documentMarker,
    controllerIdentity,
    controllerScriptUrl,
  } = input;

  if (serverFetchError) {
    return {
      ok: false,
      status: "network_error",
      reason: "Failed to fetch server client-version",
    };
  }

  const parsedMarker = parseReloadPendingMarker(marker, marker.startedAt);
  const parsedServer = parseLatestVersionMetadata(serverMetadata);
  if (!parsedMarker || !parsedServer) {
    return {
      ok: false,
      status: "malformed",
      reason: "Malformed latest metadata or reload marker",
    };
  }

  if (!controllerIdentity) {
    return {
      ok: false,
      status: "no_controller",
      reason: "No active service worker controller",
    };
  }

  if (
    controllerIdentity.protocolVersion !== 1 ||
    typeof controllerIdentity.workerNonce !== "string" ||
    !controllerIdentity.workerNonce.trim()
  ) {
    return {
      ok: false,
      status: "legacy_controller",
      reason: "Controller identity is legacy protocol v0",
    };
  }

  const target = parsedMarker.target;

  // 1. Check if server is newer or different from target
  if (parsedServer.buildId !== target.buildId) {
    return {
      ok: false,
      status: "server_newer",
      reason: `Server buildId (${parsedServer.buildId}) does not match target (${target.buildId})`,
    };
  }

  if (parsedServer.buildStamp !== target.buildStamp) {
    return {
      ok: false,
      status: "mismatch",
      reason: `Server buildStamp (${parsedServer.buildStamp}) does not match target (${target.buildStamp})`,
    };
  }

  if (parsedServer.deploymentId !== target.deploymentId) {
    return {
      ok: false,
      status: "mismatch",
      reason: `Server deploymentId (${parsedServer.deploymentId}) does not match target (${target.deploymentId})`,
    };
  }

  if (parsedServer.swVersion !== target.swVersion) {
    return {
      ok: false,
      status: "mismatch",
      reason: `Server swVersion (${parsedServer.swVersion}) does not match target (${target.swVersion})`,
    };
  }

  if (
    normalizeScriptUrl(parsedServer.serviceWorkerScriptUrl) !==
    normalizeScriptUrl(target.serviceWorkerScriptUrl)
  ) {
    return {
      ok: false,
      status: "mismatch",
      reason: `Server serviceWorkerScriptUrl (${parsedServer.serviceWorkerScriptUrl}) does not match target (${target.serviceWorkerScriptUrl})`,
    };
  }

  // 2. Document deployment marker & stamp checks
  const parsedDocMarker = parseDocumentDeploymentMarker(documentMarker);
  if (!parsedDocMarker) {
    return {
      ok: false,
      status: "mismatch",
      reason: "Document deployment marker is missing or invalid",
    };
  }
  if (parsedDocMarker.buildStamp !== target.buildStamp) {
      return {
        ok: false,
        status: "mismatch",
        reason: `Document buildStamp (${parsedDocMarker.buildStamp}) does not match target (${target.buildStamp})`,
      };
    }
    if (parsedDocMarker.buildId !== target.buildId) {
      return {
        ok: false,
        status: "mismatch",
        reason: `Document buildId (${parsedDocMarker.buildId}) does not match target (${target.buildId})`,
      };
    }
    if (parsedDocMarker.deploymentId !== target.deploymentId) {
      return {
        ok: false,
        status: "mismatch",
        reason: `Document deploymentId (${parsedDocMarker.deploymentId}) does not match target (${target.deploymentId})`,
      };
    }

  // 3. Controller identity checks
  if (controllerIdentity.buildId !== target.buildId) {
    return {
      ok: false,
      status: "mismatch",
      reason: `Controller buildId (${controllerIdentity.buildId}) does not match target (${target.buildId})`,
    };
  }

  if (controllerIdentity.swVersion !== target.swVersion) {
    return {
      ok: false,
      status: "mismatch",
      reason: `Controller swVersion (${controllerIdentity.swVersion}) does not match target (${target.swVersion})`,
    };
  }

  if (
    !controllerScriptUrl ||
    normalizeScriptUrl(controllerScriptUrl) !==
      normalizeScriptUrl(target.serviceWorkerScriptUrl)
  ) {
    return {
      ok: false,
      status: "mismatch",
      reason: `Controller script URL (${controllerScriptUrl ?? "missing"}) does not match target (${target.serviceWorkerScriptUrl})`,
    };
  }

  return { ok: true, status: "success" };
}
