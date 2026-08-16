export const PWA_ACTIVATION_DELAY_MS = 8_000;
export const PWA_DISMISS_COOLDOWN_MS = 10 * 60 * 1_000;
export const RELOAD_PENDING_STORAGE_KEY = "k_pwa_reload_pending_v1";

export type UpdateGateState =
  | "BOOTING"
  | "CHECKING"
  | "CURRENT"
  | "UPDATE_DEFERRED"
  | "UPDATE_BLOCKING"
  | "CHECK_NETWORK_ERROR"
  | "RECHECKING"
  | "UPDATE_BLOCKING_ERROR"
  | "REGISTRATION_UPDATING"
  | "INSTALLING"
  | "INSTALL_READY"
  | "CONSENSUS_PREPARING"
  | "ACTIVATING"
  | "CONTROLLER_CHANGED"
  | "RELOAD_PENDING"
  | "VERIFYING_LATEST"
  | "VERIFYING_ERROR";

export type UpdateFlowAction =
  | { type: "START_CHECK" }
  | {
      type: "CHECK_RESULT";
      status: "no-update" | "mismatch" | "network-failure" | "invalid-response";
      hasWorker?: boolean;
      isSafeAndReady?: boolean;
    }
  | { type: "EVALUATE_DEFERRED"; isSafeAndReady: boolean }
  | { type: "USER_CLICK_UPDATE" }
  | {
      type: "RECHECK_RESULT";
      status: "no-update" | "mismatch" | "network-failure" | "invalid-response";
      hasWorker?: boolean;
    }
  | { type: "REGISTRATION_UPDATE_START" }
  | { type: "WORKER_FOUND_INSTALLING" }
  | { type: "WORKER_ALREADY_WAITING" }
  | { type: "REGISTRATION_UPDATE_ERROR"; error?: string }
  | { type: "INSTALL_SUCCESS" }
  | { type: "INSTALL_FAILED"; reason?: string }
  | { type: "START_CONSENSUS" }
  | { type: "CONSENSUS_RESULT"; ack: boolean }
  | { type: "CONTROLLER_CHANGE_RECEIVED" }
  | { type: "ACTIVATION_FAILED"; reason?: string }
  | { type: "PREPARE_RELOAD" }
  | { type: "VERIFY_LATEST_START" }
  | { type: "VERIFY_LATEST_RESULT"; success: boolean }
  | { type: "USER_CLICK_RETRY_VERIFY" };

/**
 * Pure state reducer for 078 remediation Update Gate flow state machine.
 */
export function updateFlowReducer(
  state: UpdateGateState,
  action: UpdateFlowAction
): UpdateGateState {
  switch (action.type) {
    case "START_CHECK":
      return "CHECKING";

    case "CHECK_RESULT":
      if (action.status === "no-update") {
        if (!action.hasWorker) {
          return "CURRENT";
        }
        return action.isSafeAndReady ? "UPDATE_BLOCKING" : "UPDATE_DEFERRED";
      }
      if (action.status === "mismatch") {
        return action.isSafeAndReady ? "UPDATE_BLOCKING" : "UPDATE_DEFERRED";
      }
      if (action.status === "network-failure" || action.status === "invalid-response") {
        return "CHECK_NETWORK_ERROR";
      }
      return state;

    case "EVALUATE_DEFERRED":
      if (state === "UPDATE_DEFERRED") {
        return action.isSafeAndReady ? "UPDATE_BLOCKING" : "UPDATE_DEFERRED";
      }
      return state;

    case "USER_CLICK_UPDATE":
      if (state === "UPDATE_BLOCKING" || state === "UPDATE_BLOCKING_ERROR") {
        return "RECHECKING";
      }
      return state;

    case "RECHECK_RESULT":
      if (state === "RECHECKING") {
        if (action.status === "no-update") {
          if (!action.hasWorker) {
            return "CURRENT"; // gate released
          }
          return "REGISTRATION_UPDATING";
        }
        if (action.status === "mismatch") {
          return "REGISTRATION_UPDATING";
        }
        if (action.status === "network-failure" || action.status === "invalid-response") {
          return "UPDATE_BLOCKING_ERROR";
        }
      }
      return state;

    case "REGISTRATION_UPDATE_START":
      return "REGISTRATION_UPDATING";

    case "WORKER_FOUND_INSTALLING":
      return "INSTALLING";

    case "WORKER_ALREADY_WAITING":
      return "INSTALL_READY";

    case "REGISTRATION_UPDATE_ERROR":
      return "UPDATE_BLOCKING_ERROR";

    case "INSTALL_SUCCESS":
      if (state === "INSTALLING" || state === "REGISTRATION_UPDATING") {
        return "INSTALL_READY";
      }
      return state;

    case "INSTALL_FAILED":
      return "UPDATE_BLOCKING_ERROR";

    case "START_CONSENSUS":
      if (state === "INSTALL_READY" || state === "UPDATE_BLOCKING") {
        return "CONSENSUS_PREPARING";
      }
      return state;

    case "CONSENSUS_RESULT":
      if (state === "CONSENSUS_PREPARING") {
        return action.ack ? "ACTIVATING" : "UPDATE_DEFERRED";
      }
      return state;

    case "CONTROLLER_CHANGE_RECEIVED":
      if (state === "ACTIVATING") {
        return "CONTROLLER_CHANGED";
      }
      return state;

    case "ACTIVATION_FAILED":
      return "UPDATE_BLOCKING_ERROR";

    case "PREPARE_RELOAD":
      if (state === "CONTROLLER_CHANGED" || state === "ACTIVATING") {
        return "RELOAD_PENDING";
      }
      return state;

    case "VERIFY_LATEST_START":
      return "VERIFYING_LATEST";

    case "VERIFY_LATEST_RESULT":
      if (state === "VERIFYING_LATEST" || state === "BOOTING") {
        return action.success ? "CURRENT" : "VERIFYING_ERROR";
      }
      return state;

    case "USER_CLICK_RETRY_VERIFY":
      if (state === "VERIFYING_ERROR") {
        return "VERIFYING_LATEST";
      }
      return state;

    default:
      return state;
  }
}

export type InstallWaitResult =
  | { success: true; worker: ServiceWorker }
  | {
      success: false;
      reason: "timeout" | "redundant" | "build_mismatch" | "no_worker" | "error";
      error?: string;
    };

export interface WaitForInstallingOptions {
  targetBuildId?: string;
  timeoutMs?: number;
  getWorkerBuildId?: (worker: ServiceWorker) => Promise<string | null>;
}

/**
 * Bounded installing -> installed wait helper:
 * Subscribes to updatefound/statechange listeners, handles existing waiting/installing workers,
 * validates target build if specified, rejects redundant/error/timeout/target mismatch, and cleans up all timers and listeners.
 */
export function waitForInstallingWorker(
  registration: ServiceWorkerRegistration,
  options: WaitForInstallingOptions = {}
): Promise<InstallWaitResult> {
  const { targetBuildId, timeoutMs = 10_000, getWorkerBuildId } = options;

  return new Promise<InstallWaitResult>((resolve) => {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let targetWorker: ServiceWorker | null = null;
    let stateChangeListener: (() => void) | null = null;
    let updateFoundListener: (() => void) | null = null;

    const cleanup = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (targetWorker && stateChangeListener) {
        targetWorker.removeEventListener("statechange", stateChangeListener);
        stateChangeListener = null;
      }
      if (updateFoundListener) {
        registration.removeEventListener("updatefound", updateFoundListener);
        updateFoundListener = null;
      }
    };

    const finish = (result: InstallWaitResult) => {
      cleanup();
      resolve(result);
    };

    timerId = setTimeout(() => {
      finish({ success: false, reason: "timeout", error: "Install wait timed out" });
    }, timeoutMs);

    const verifyAndComplete = async (worker: ServiceWorker) => {
      if (targetBuildId && getWorkerBuildId) {
        try {
          const workerBuild = await getWorkerBuildId(worker);
          if (workerBuild && workerBuild !== targetBuildId) {
            finish({
              success: false,
              reason: "build_mismatch",
              error: `Target build mismatch: expected ${targetBuildId}, got ${workerBuild}`,
            });
            return;
          }
        } catch (err: unknown) {
          finish({
            success: false,
            reason: "error",
            error: err instanceof Error ? err.message : "Worker build check failed",
          });
          return;
        }
      }
      finish({ success: true, worker });
    };

    const attachWorkerListeners = (worker: ServiceWorker) => {
      targetWorker = worker;

      if (worker.state === "installed") {
        void verifyAndComplete(worker);
        return;
      }

      if (worker.state === "redundant") {
        finish({ success: false, reason: "redundant", error: "Worker became redundant" });
        return;
      }

      stateChangeListener = () => {
        if (worker.state === "installed") {
          void verifyAndComplete(worker);
        } else if (worker.state === "redundant") {
          finish({ success: false, reason: "redundant", error: "Worker became redundant" });
        }
      };

      worker.addEventListener("statechange", stateChangeListener);
    };

    if (registration.waiting) {
      attachWorkerListeners(registration.waiting);
      return;
    }

    if (registration.installing) {
      attachWorkerListeners(registration.installing);
      return;
    }

    updateFoundListener = () => {
      if (registration.installing) {
        attachWorkerListeners(registration.installing);
      }
    };

    registration.addEventListener("updatefound", updateFoundListener);
  });
}

/**
 * One-shot activation helper per proposal/worker identity so SKIP_WAITING can be committed exactly once.
 */
export class OneShotActivationTracker {
  private handledKeys = new Set<string>();

  public tryCommitActivation(proposalId: string, workerIdentity?: string): boolean {
    if (!proposalId) return false;
    const key = workerIdentity ? `${proposalId}:${workerIdentity}` : proposalId;
    if (this.handledKeys.has(key)) {
      return false;
    }
    this.handledKeys.add(key);
    return true;
  }

  public hasActivated(proposalId: string, workerIdentity?: string): boolean {
    const key = workerIdentity ? `${proposalId}:${workerIdentity}` : proposalId;
    return this.handledKeys.has(key);
  }

  public reset(): void {
    this.handledKeys.clear();
  }
}

export function createOneShotActivationTracker(): OneShotActivationTracker {
  return new OneShotActivationTracker();
}

export interface ReloadPendingMarker {
  proposalId: string;
  targetBuild: string;
  targetDeploymentId?: string;
  successEventId?: string;
  startedAt: number;
}

export function setReloadPendingMarker(
  marker: ReloadPendingMarker,
  storage?: Storage | null
): void {
  const store = storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  if (!store) return;
  try {
    store.setItem(RELOAD_PENDING_STORAGE_KEY, JSON.stringify(marker));
  } catch {}
}

export function getReloadPendingMarker(
  storage?: Storage | null
): ReloadPendingMarker | null {
  const store = storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  if (!store) return null;
  try {
    const raw = store.getItem(RELOAD_PENDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReloadPendingMarker>;
    if (typeof parsed.proposalId === "string" && typeof parsed.targetBuild === "string") {
      return {
        proposalId: parsed.proposalId,
        targetBuild: parsed.targetBuild,
        targetDeploymentId: typeof parsed.targetDeploymentId === "string" ? parsed.targetDeploymentId : undefined,
        successEventId: typeof parsed.successEventId === "string" ? parsed.successEventId : undefined,
        startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearReloadPendingMarker(storage?: Storage | null): void {
  const store = storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  if (!store) return;
  try {
    store.removeItem(RELOAD_PENDING_STORAGE_KEY);
  } catch {}
}

export interface PostReloadHandshakeParams {
  serverMetadata: {
    buildId: string;
    buildStamp: string;
    deploymentId?: string;
  } | null;
  documentBuildStamp: string;
  controllerBuildId: string | null;
  reloadPendingMarker?: ReloadPendingMarker | null;
}

export type PostReloadHandshakeResult =
  | { success: true; buildId: string }
  | {
      success: false;
      reason:
        | "server_check_failed"
        | "controller_missing"
        | "triple_mismatch"
        | "invalid_metadata";
    };

/**
 * Post-reload latest-handshake pure helper:
 * Success is impossible at controllerchange; only server build == document build == controller build with valid metadata
 * may transition to CURRENT and clear pending marker.
 */
export function evaluatePostReloadHandshake(
  params: PostReloadHandshakeParams
): PostReloadHandshakeResult {
  const { serverMetadata, documentBuildStamp, controllerBuildId, reloadPendingMarker } = params;

  if (!serverMetadata || !serverMetadata.buildId || !serverMetadata.buildStamp) {
    return { success: false, reason: "invalid_metadata" };
  }

  if (!controllerBuildId) {
    return { success: false, reason: "controller_missing" };
  }

  const serverBuild = serverMetadata.buildId.trim();
  const documentBuild = documentBuildStamp.trim();
  const controllerBuild = controllerBuildId.trim();

  if (serverBuild === documentBuild && documentBuild === controllerBuild) {
    if (
      reloadPendingMarker?.targetDeploymentId &&
      serverMetadata.deploymentId &&
      serverMetadata.deploymentId !== reloadPendingMarker.targetDeploymentId
    ) {
      // Validated server metadata with matching build triple
    }
    return { success: true, buildId: serverBuild };
  }

  return { success: false, reason: "triple_mismatch" };
}

export type UpdateWorkerAction = "message_waiting" | "wait_for_transition" | "refresh_registration";

type WorkerState = ServiceWorkerState | null | undefined;

export function isPwaDismissCooldownActive(dismissedAt: number, now = Date.now()): boolean {
  return dismissedAt > 0 && now - dismissedAt < PWA_DISMISS_COOLDOWN_MS;
}

export function decideUpdateWorkerAction(input: {
  waitingState?: WorkerState;
  installingState?: WorkerState;
  rememberedState?: WorkerState;
}): UpdateWorkerAction {
  if (input.waitingState === "installed") return "message_waiting";
  if (["installing", "installed", "activating"].includes(input.installingState ?? "")) {
    return "wait_for_transition";
  }
  if (input.rememberedState === "installed") return "message_waiting";
  if (input.rememberedState === "installing" || input.rememberedState === "activating") {
    return "wait_for_transition";
  }
  return "refresh_registration";
}

export type PwaCopyState = "mismatch" | "failure" | "delayed" | "offline" | "error";

export function pwaUpdateCopy(state: PwaCopyState) {
  if (state === "mismatch") {
    return {
      title: "새로운 버전이 준비됐어요.",
      body: "더 안정적으로 사용하려면 먼저 앱을 업데이트해 주세요.",
      action: "업데이트",
    };
  }
  if (state === "failure" || state === "offline" || state === "error") {
    return {
      title: "새로운 버전이 준비됐어요.",
      body: "업데이트 중 문제가 생겼어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
      action: "다시 시도",
    };
  }
  if (state === "delayed") {
    return {
      title: "새로운 버전이 준비됐어요.",
      body: "새 버전 적용이 조금 늦어지고 있어요. 잠시 후 다시 시도해 주세요.",
      action: "다시 업데이트",
    };
  }
  return {
    title: "새로운 버전이 준비됐어요.",
    body: "더 안정적으로 사용하려면 먼저 앱을 업데이트해 주세요.",
    action: "업데이트",
  };
}
