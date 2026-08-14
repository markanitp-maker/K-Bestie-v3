/**
 * Shared Recovery Coordinator between StaleClientRecovery, ClientVersionGate, and PwaServiceWorker.
 *
 * StaleClientRecovery and ClientVersionGate validate stale asset errors and version signals,
 * then delegate orchestration exclusively to PwaServiceWorker.
 */

export interface ExternalControllerPendingV1 {
  schemaVersion: 1;
  observedAt: number;
  controllerBuildId: string | null;
  controllerSwVersion: string | null;
  controllerScriptUrl: string | null;
}

export interface StaleRecoverySignal {
  source: "chunk_error" | "sw_message" | "unhandled_rejection" | "manual" | "mission_gate";
  pathname?: string;
  buildId?: string;
  workerNonce?: string;
  timestamp: number;
}

export const EXTERNAL_CONTROLLER_PENDING_KEY = "k_pwa_external_controller_pending";

type StaleRecoveryListener = (signal: StaleRecoverySignal) => void;

const listeners: Set<StaleRecoveryListener> = new Set();
let inMemoryPending: ExternalControllerPendingV1 | null = null;

/**
 * Subscribe to stale recovery requests.
 * Used by PwaServiceWorker to handle unified update & recovery flows.
 */
export function subscribeStaleRecovery(listener: StaleRecoveryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Request stale recovery from any error, gate, or message handler.
 */
export function requestStaleRecovery(signal: StaleRecoverySignal): void {
  for (const listener of listeners) {
    try {
      listener(signal);
    } catch (err) {
      console.error("[RecoveryCoordinator] listener error", err);
    }
  }
}

export function parseExternalControllerPending(raw: unknown): ExternalControllerPendingV1 | null {
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1) return null;
  if (typeof obj.observedAt !== "number" || !Number.isFinite(obj.observedAt) || obj.observedAt <= 0) {
    return null;
  }

  const controllerBuildId =
    typeof obj.controllerBuildId === "string" && obj.controllerBuildId.trim()
      ? obj.controllerBuildId.trim()
      : null;
  const controllerSwVersion =
    typeof obj.controllerSwVersion === "string" && obj.controllerSwVersion.trim()
      ? obj.controllerSwVersion.trim()
      : null;
  const controllerScriptUrl =
    typeof obj.controllerScriptUrl === "string" && obj.controllerScriptUrl.trim()
      ? obj.controllerScriptUrl.trim()
      : null;

  return {
    schemaVersion: 1,
    observedAt: obj.observedAt,
    controllerBuildId,
    controllerSwVersion,
    controllerScriptUrl,
  };
}

export function saveExternalControllerPending(
  pending: ExternalControllerPendingV1,
  storage: Pick<Storage, "setItem"> | null = typeof window !== "undefined" && window.sessionStorage
    ? window.sessionStorage
    : null
): boolean {
  inMemoryPending = pending;
  if (!storage) return true;
  try {
    storage.setItem(EXTERNAL_CONTROLLER_PENDING_KEY, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function getExternalControllerPending(
  storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined" && window.sessionStorage
    ? window.sessionStorage
    : null
): ExternalControllerPendingV1 | null {
  if (inMemoryPending) return inMemoryPending;
  if (!storage) return null;
  try {
    const raw = storage.getItem(EXTERNAL_CONTROLLER_PENDING_KEY);
    const parsed = parseExternalControllerPending(raw);
    if (parsed) {
      inMemoryPending = parsed;
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearExternalControllerPending(
  storage: Pick<Storage, "removeItem"> | null = typeof window !== "undefined" && window.sessionStorage
    ? window.sessionStorage
    : null
): void {
  inMemoryPending = null;
  if (!storage) return;
  try {
    storage.removeItem(EXTERNAL_CONTROLLER_PENDING_KEY);
  } catch {}
}

export function resetRecoveryCoordinatorForTest(): void {
  listeners.clear();
  inMemoryPending = null;
}
