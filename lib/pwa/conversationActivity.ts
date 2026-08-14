import {
  ActivationProposal,
  parseActivationProposal,
} from "./swProtocol";
import { LatestVersionMetadataV1 } from "./clientVersion";

export const PWA_ACTIVATION_PROPOSAL_STORAGE_KEY = "k_pwa_activation_proposal_v1";
export const PWA_UPDATE_BROADCAST_CHANNEL_NAME = "kbestie:pwa-update:v1";

export type ActivationBarrierPhase = "preparing" | "committed";
export type ActivationBarrierStatus = "closed" | "preparing" | "committed";

export interface ActivationBarrierState {
  active: boolean;
  status: ActivationBarrierStatus;
  proposalId: string | null;
  targetBuild: string | null;
  target?: LatestVersionMetadataV1 | null;
  phase: ActivationBarrierPhase | null;
  expiresAt: number | null;
  error?: string | null;
}

export type ActivationBarrierEvent =
  | {
      type: "PREPARE";
      proposalId: string;
      targetBuild: string;
      target?: LatestVersionMetadataV1 | null;
      expiresAt: number;
      now?: number;
    }
  | { type: "COMMIT"; proposalId: string }
  | { type: "ABORT"; proposalId: string; reason?: string }
  | { type: "EXPIRY_TIMER"; proposalId: string; now?: number }
  | { type: "STORAGE_REMOVE" }
  | { type: "TRANSFER_BLOCKING_ERROR"; proposalId?: string; error: string }
  | { type: "CLEAR"; proposalId?: string };

export interface ConversationHazard {
  id: string;
  source: string;
  reason: string;
  createdAt: number;
}

export interface ConversationActivitySnapshot {
  ready: boolean;
  isAnyActive: boolean;
  hazardsCount: number;
  hazards: Record<string, string[]>;
}

export interface HazardTokenHandle {
  id: string;
  source: string;
  reason: string;
  release: () => void;
}

// -------------------------------------------------------------
// Central Blocking Error Store
// -------------------------------------------------------------
let centralBlockingErrorState: string | null = null;

export function getCentralBlockingError(): string | null {
  return centralBlockingErrorState;
}

export function setCentralBlockingError(error: string | null): void {
  centralBlockingErrorState = error;
}

export function clearCentralBlockingError(): void {
  centralBlockingErrorState = null;
}

// -------------------------------------------------------------
// Pure Barrier Reducer
// -------------------------------------------------------------
export function reduceActivationBarrier(
  state: ActivationBarrierState,
  event: ActivationBarrierEvent,
  now = Date.now()
): ActivationBarrierState {
  switch (event.type) {
    case "PREPARE": {
      const eventNow = event.now ?? now;
      if (event.expiresAt <= eventNow) {
        if (state.proposalId === event.proposalId) {
          return {
            active: false,
            status: "closed",
            proposalId: null,
            targetBuild: null,
            target: null,
            phase: null,
            expiresAt: null,
            error: state.error ?? null,
          };
        }
        return state;
      }

      // If already in committed phase for the same proposal, do not downgrade back to preparing
      if (state.proposalId === event.proposalId && state.status === "committed") {
        return {
          ...state,
          active: true,
          status: "committed",
          phase: "committed",
          expiresAt: event.expiresAt,
          target: event.target ?? state.target,
        };
      }

      return {
        active: true,
        status: "preparing",
        phase: "preparing",
        proposalId: event.proposalId,
        targetBuild: event.targetBuild,
        target: event.target ?? null,
        expiresAt: event.expiresAt,
        error: null,
      };
    }

    case "COMMIT": {
      if (state.proposalId === event.proposalId && state.active) {
        return {
          ...state,
          active: true,
          status: "committed",
          phase: "committed",
        };
      }
      return state;
    }

    case "ABORT": {
      if (state.proposalId === event.proposalId) {
        return {
          active: false,
          status: "closed",
          proposalId: null,
          targetBuild: null,
          target: null,
          phase: null,
          expiresAt: null,
          error: null,
        };
      }
      return state;
    }

    case "EXPIRY_TIMER": {
      const timerNow = event.now ?? now;
      if (state.proposalId === event.proposalId && timerNow >= (state.expiresAt ?? 0)) {
        if (state.status === "committed") {
          // Committed barrier expired before reload/handshake verification was completed.
          // Transfer to central blocking error rather than orphaning silently.
          setCentralBlockingError("committed_barrier_expired");
          return {
            active: false,
            status: "closed",
            proposalId: null,
            targetBuild: null,
            target: null,
            phase: null,
            expiresAt: null,
            error: "committed_barrier_expired",
          };
        }
        return {
          active: false,
          status: "closed",
          proposalId: null,
          targetBuild: null,
          target: null,
          phase: null,
          expiresAt: null,
          error: null,
        };
      }
      return state;
    }

    case "STORAGE_REMOVE": {
      if (state.status === "preparing") {
        return {
          active: false,
          status: "closed",
          proposalId: null,
          targetBuild: null,
          target: null,
          phase: null,
          expiresAt: null,
          error: null,
        };
      }
      // Committed barrier persists through storage removal until reload verification
      return state;
    }

    case "TRANSFER_BLOCKING_ERROR": {
      if (!event.proposalId || state.proposalId === event.proposalId) {
        setCentralBlockingError(event.error);
        return {
          active: false,
          status: "closed",
          proposalId: null,
          targetBuild: null,
          target: null,
          phase: null,
          expiresAt: null,
          error: event.error,
        };
      }
      return state;
    }

    case "CLEAR": {
      if (event.proposalId && state.proposalId !== event.proposalId) {
        return state;
      }
      return {
        active: false,
        status: "closed",
        proposalId: null,
        targetBuild: null,
        target: null,
        phase: null,
        expiresAt: null,
        error: null,
      };
    }

    default:
      return state;
  }
}

// -------------------------------------------------------------
// Singleton Barrier State (Always active in Production & Dev)
// -------------------------------------------------------------
let barrierState: ActivationBarrierState = {
  active: false,
  status: "closed",
  proposalId: null,
  targetBuild: null,
  target: null,
  phase: null,
  expiresAt: null,
};

let barrierExpiryTimer: ReturnType<typeof setTimeout> | null = null;
const barrierListeners = new Set<(state: ActivationBarrierState) => void>();
let storageListenerInitialized = false;

function notifyBarrierListeners() {
  const snapshot = getActivationBarrierState();
  for (const listener of barrierListeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error("[conversationActivity] barrier listener error:", err);
    }
  }
}

function clearBarrierExpiryTimer() {
  if (barrierExpiryTimer !== null) {
    clearTimeout(barrierExpiryTimer);
    barrierExpiryTimer = null;
  }
}

function scheduleBarrierExpiry(expiresAt: number, proposalId: string) {
  clearBarrierExpiryTimer();
  const delay = Math.max(0, expiresAt - Date.now());
  barrierExpiryTimer = setTimeout(() => {
    barrierExpiryTimer = null;
    dispatchBarrierEvent({
      type: "EXPIRY_TIMER",
      proposalId,
      now: Date.now(),
    });
  }, delay);
}

export function dispatchBarrierEvent(event: ActivationBarrierEvent): ActivationBarrierState {
  const nextState = reduceActivationBarrier(barrierState, event, Date.now());
  const changed =
    barrierState.active !== nextState.active ||
    barrierState.status !== nextState.status ||
    barrierState.proposalId !== nextState.proposalId ||
    barrierState.phase !== nextState.phase ||
    barrierState.expiresAt !== nextState.expiresAt ||
    barrierState.error !== nextState.error;

  barrierState = nextState;

  if (barrierState.active && barrierState.expiresAt !== null && barrierState.proposalId !== null) {
    scheduleBarrierExpiry(barrierState.expiresAt, barrierState.proposalId);
  } else {
    clearBarrierExpiryTimer();
  }

  if (changed) {
    notifyBarrierListeners();
  }

  return barrierState;
}

export function getActivationBarrierState(): ActivationBarrierState {
  if (
    barrierState.active &&
    barrierState.expiresAt !== null &&
    Date.now() >= barrierState.expiresAt
  ) {
    dispatchBarrierEvent({
      type: "EXPIRY_TIMER",
      proposalId: barrierState.proposalId || "",
      now: Date.now(),
    });
  }
  return { ...barrierState };
}

export function isActivationBarrierActive(): boolean {
  return getActivationBarrierState().active;
}

export function openActivationBarrier(
  proposal: {
    proposalId: string;
    targetBuild: string;
    target?: LatestVersionMetadataV1 | null;
    expiresAt: number;
  },
  phase: ActivationBarrierPhase = "preparing"
): void {
  dispatchBarrierEvent({
    type: "PREPARE",
    proposalId: proposal.proposalId,
    targetBuild: proposal.targetBuild,
    target: proposal.target,
    expiresAt: proposal.expiresAt,
    now: Date.now(),
  });

  if (phase === "committed") {
    dispatchBarrierEvent({
      type: "COMMIT",
      proposalId: proposal.proposalId,
    });
  }
}

export function commitActivationBarrier(proposalId: string): void {
  dispatchBarrierEvent({
    type: "COMMIT",
    proposalId,
  });
}

export function abortActivationBarrier(proposalId: string, reason?: string): void {
  dispatchBarrierEvent({
    type: "ABORT",
    proposalId,
    reason,
  });
}

export function clearActivationBarrier(proposalId?: string): void {
  dispatchBarrierEvent({
    type: "CLEAR",
    proposalId,
  });
}

export function transferCommittedBarrierToBlockingError(
  proposalId?: string,
  error = "committed_barrier_verification_failed"
): void {
  dispatchBarrierEvent({
    type: "TRANSFER_BLOCKING_ERROR",
    proposalId,
    error,
  });
}

export function restoreActivationBarrierFromStorage(
  storage?: Storage | null,
  now = Date.now()
): ActivationBarrierState {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return getActivationBarrierState();

  try {
    const raw = store.getItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
    if (!raw) {
      dispatchBarrierEvent({ type: "STORAGE_REMOVE" });
      return getActivationBarrierState();
    }

    const proposal = parseActivationProposal(raw, now);
    if (proposal && proposal.expiresAt > now) {
      dispatchBarrierEvent({
        type: "PREPARE",
        proposalId: proposal.proposalId,
        targetBuild: proposal.targetBuild,
        target: proposal.target,
        expiresAt: proposal.expiresAt,
        now,
      });
    } else {
      store.removeItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
      dispatchBarrierEvent({ type: "STORAGE_REMOVE" });
    }
  } catch {}

  return getActivationBarrierState();
}

export function subscribeActivationBarrier(
  listener: (state: ActivationBarrierState) => void
): () => void {
  barrierListeners.add(listener);
  initActivationBarrierStorageSync();
  try {
    listener(getActivationBarrierState());
  } catch (err) {
    console.error("[conversationActivity] immediate barrier listener error:", err);
  }

  return () => {
    barrierListeners.delete(listener);
    // Listener unmount only removes the subscriber; it does NOT clear an active proposal!
  };
}

export function initActivationBarrierStorageSync(): void {
  if (storageListenerInitialized || typeof window === "undefined") return;
  storageListenerInitialized = true;

  // Restore on initial sync
  restoreActivationBarrierFromStorage();

  // Listen for storage events across tabs
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key !== PWA_ACTIVATION_PROPOSAL_STORAGE_KEY) return;
    if (!event.newValue) {
      dispatchBarrierEvent({ type: "STORAGE_REMOVE" });
    } else {
      const parsed = parseActivationProposal(event.newValue);
      if (parsed && parsed.expiresAt > Date.now()) {
        dispatchBarrierEvent({
          type: "PREPARE",
          proposalId: parsed.proposalId,
          targetBuild: parsed.targetBuild,
          target: parsed.target,
          expiresAt: parsed.expiresAt,
          now: Date.now(),
        });
      } else {
        dispatchBarrierEvent({ type: "STORAGE_REMOVE" });
      }
    }
  });

  // Listen for BroadcastChannel messages
  if ("BroadcastChannel" in window) {
    try {
      const bc = new BroadcastChannel(PWA_UPDATE_BROADCAST_CHANNEL_NAME);
      bc.addEventListener("message", (ev: MessageEvent) => {
        const data = ev.data;
        if (!data || typeof data !== "object" || data.protocol !== 1) return;
        if (data.type === "PWA_PROPOSAL_BROADCAST_HINT" && data.proposal) {
          const parsed = parseActivationProposal(data.proposal);
          if (parsed && parsed.expiresAt > Date.now()) {
            dispatchBarrierEvent({
              type: "PREPARE",
              proposalId: parsed.proposalId,
              targetBuild: parsed.targetBuild,
              target: parsed.target,
              expiresAt: parsed.expiresAt,
              now: Date.now(),
            });
          }
        } else if (
          data.type === "PWA_ACTIVATION_COMMITTED" &&
          typeof data.proposalId === "string"
        ) {
          dispatchBarrierEvent({
            type: "COMMIT",
            proposalId: data.proposalId,
          });
        } else if (
          data.type === "PWA_ACTIVATION_ABORTED" &&
          typeof data.proposalId === "string"
        ) {
          dispatchBarrierEvent({
            type: "ABORT",
            proposalId: data.proposalId,
            reason: typeof data.reason === "string" ? data.reason : undefined,
          });
        }
      });
    } catch {}
  }
}

// -------------------------------------------------------------
// Conversation Hazard Registry
// -------------------------------------------------------------
const activeHazards = new Map<string, ConversationHazard>();
let isActivityReadyState = true;
const activityListeners = new Set<(snapshot: ConversationActivitySnapshot) => void>();

function notifyActivityListeners() {
  const snapshot = getConversationActivitySnapshot();
  for (const listener of activityListeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error("[conversationActivity] activity listener error:", err);
    }
  }
}

export function setConversationActivityReady(ready: boolean): void {
  if (isActivityReadyState !== ready) {
    isActivityReadyState = ready;
    notifyActivityListeners();
  }
}

export function getConversationActivitySnapshot(): ConversationActivitySnapshot {
  const hazardsGrouped: Record<string, string[]> = {};
  for (const hazard of activeHazards.values()) {
    if (!hazardsGrouped[hazard.source]) {
      hazardsGrouped[hazard.source] = [];
    }
    hazardsGrouped[hazard.source].push(hazard.reason);
  }

  return {
    ready: isActivityReadyState,
    isAnyActive: activeHazards.size > 0,
    hazardsCount: activeHazards.size,
    hazards: hazardsGrouped,
  };
}

export function isConversationActive(): boolean {
  return activeHazards.size > 0;
}

/**
 * Synchronously checks if an activation barrier is active before acquiring a hazard token.
 * If barrier is active, returns null (cannot start conversation while barrier is up).
 * If barrier is not active, registers the hazard token synchronously and returns the handle.
 */
export function tryAcquireConversationHazard(
  source: string,
  reason: string
): HazardTokenHandle | null {
  if (isActivationBarrierActive()) {
    return null;
  }

  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `hz_${Date.now()}_${Math.random()}`;
  const hazard: ConversationHazard = {
    id,
    source,
    reason,
    createdAt: Date.now(),
  };

  activeHazards.set(id, hazard);
  notifyActivityListeners();

  let released = false;
  return {
    id,
    source,
    reason,
    release: () => {
      if (released) return;
      released = true;
      activeHazards.delete(id);
      notifyActivityListeners();
    },
  };
}

/**
 * Force-acquires a hazard token for existing operations that must report hazard state
 * regardless of barrier (e.g. active settlement finishing).
 */
export function acquireHazardToken(source: string, reason: string): HazardTokenHandle {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `hz_${Date.now()}_${Math.random()}`;
  const hazard: ConversationHazard = {
    id,
    source,
    reason,
    createdAt: Date.now(),
  };

  activeHazards.set(id, hazard);
  notifyActivityListeners();

  let released = false;
  return {
    id,
    source,
    reason,
    release: () => {
      if (released) return;
      released = true;
      activeHazards.delete(id);
      notifyActivityListeners();
    },
  };
}

export function releaseAllHazardsForSource(source: string): void {
  let changed = false;
  for (const [id, hazard] of activeHazards.entries()) {
    if (hazard.source === source) {
      activeHazards.delete(id);
      changed = true;
    }
  }
  if (changed) {
    notifyActivityListeners();
  }
}

export function subscribeConversationActivity(
  listener: (snapshot: ConversationActivitySnapshot) => void
): () => void {
  activityListeners.add(listener);
  try {
    listener(getConversationActivitySnapshot());
  } catch (err) {
    console.error("[conversationActivity] immediate activity listener error:", err);
  }

  return () => {
    activityListeners.delete(listener);
  };
}

export function resetConversationActivityStateForTest(): void {
  activeHazards.clear();
  isActivityReadyState = true;
  clearBarrierExpiryTimer();
  clearCentralBlockingError();
  barrierState = {
    active: false,
    status: "closed",
    proposalId: null,
    targetBuild: null,
    target: null,
    phase: null,
    expiresAt: null,
    error: null,
  };
  storageListenerInitialized = false;
}
