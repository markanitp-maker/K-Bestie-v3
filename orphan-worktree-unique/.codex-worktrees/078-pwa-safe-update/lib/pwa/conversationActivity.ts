export type ConversationSource = "mission" | "freechat" | (string & {});

export type ActivationBarrierPhase = "preparing" | "committed";

export interface ActivationBarrierState {
  active: boolean;
  proposalId: string | null;
  targetBuild: string | null;
  phase: ActivationBarrierPhase | null;
  expiresAt: number | null;
}

export interface ConversationActivitySnapshot {
  ready: boolean;
  hazards: Record<string, string[]>;
  isAnyActive: boolean;
  activationBarrier: boolean;
}

export type ConversationActivityListener = (
  snapshot: ConversationActivitySnapshot,
) => void;

export type ActivationBarrierListener = (
  state: ActivationBarrierState,
) => void;

interface HazardToken {
  id: string;
  source: string;
  reason: string;
}

const hazardTokens = new Map<string, HazardToken>();
const activityListeners = new Set<ConversationActivityListener>();
const barrierListeners = new Set<ActivationBarrierListener>();

const resolvedProposalIds = new Set<string>();

let barrierState: ActivationBarrierState = {
  active: false,
  proposalId: null,
  targetBuild: null,
  phase: null,
  expiresAt: null,
};

let barrierExpiryTimer: ReturnType<typeof setTimeout> | null = null;
let isReadyState = false;
let hasPublishedEver = false;
let tokenIdCounter = 0;

function computeHazards(): Record<string, string[]> {
  const map: Record<string, Set<string>> = {};
  for (const token of hazardTokens.values()) {
    if (!map[token.source]) {
      map[token.source] = new Set<string>();
    }
    map[token.source].add(token.reason);
  }
  const result: Record<string, string[]> = {};
  for (const [source, set] of Object.entries(map)) {
    result[source] = Array.from(set);
  }
  return result;
}

function notifyActivityListeners(): void {
  const snapshot = getConversationActivitySnapshot();
  activityListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (e) {
      console.error("[conversationActivity] Listener error:", e);
    }
  });
}

function notifyBarrierListeners(): void {
  barrierListeners.forEach((listener) => {
    try {
      listener({ ...barrierState });
    } catch (e) {
      console.error("[conversationActivity] Barrier listener error:", e);
    }
  });
}

function clearBarrierTimer(): void {
  if (barrierExpiryTimer !== null) {
    clearTimeout(barrierExpiryTimer);
    barrierExpiryTimer = null;
  }
}

export interface OpenBarrierProposalParams {
  proposalId: string;
  targetBuild: string;
  expiresAt: number;
  phase?: ActivationBarrierPhase;
}

/**
 * Open or update activation barrier singleton.
 * Returns true if barrier successfully opened or updated.
 */
export function openActivationBarrier(
  params: OpenBarrierProposalParams,
  now = Date.now(),
): boolean {
  const { proposalId, targetBuild, expiresAt, phase = "preparing" } = params;

  if (!proposalId || typeof proposalId !== "string") return false;
  if (resolvedProposalIds.has(proposalId)) return false;
  if (now >= expiresAt) {
    resolvedProposalIds.add(proposalId);
    return false;
  }

  // If a different preparing proposal exists, mark old as resolved/replaced
  if (
    barrierState.proposalId &&
    barrierState.proposalId !== proposalId &&
    barrierState.phase === "preparing"
  ) {
    resolvedProposalIds.add(barrierState.proposalId);
  }

  clearBarrierTimer();

  barrierState = {
    active: true,
    proposalId,
    targetBuild: targetBuild || null,
    phase,
    expiresAt,
  };

  const ttlMs = Math.max(0, expiresAt - now);
  barrierExpiryTimer = setTimeout(() => {
    if (barrierState.proposalId === proposalId) {
      clearActivationBarrier(proposalId, "expiry");
    }
  }, ttlMs);

  notifyBarrierListeners();
  notifyActivityListeners();
  return true;
}

/**
 * Transition barrier phase to 'committed' (stays active through reload/handshake).
 */
export function commitActivationBarrier(proposalId: string): void {
  if (!barrierState.proposalId || barrierState.proposalId !== proposalId) return;
  barrierState = {
    ...barrierState,
    phase: "committed",
    active: true,
  };
  notifyBarrierListeners();
  notifyActivityListeners();
}

/**
 * Clear activation barrier if proposal matches.
 * Note: ABORT/replacement/expiry should supply matching proposalId.
 */
export function clearActivationBarrier(
  proposalId?: string,
  reason?: string,
): void {
  if (proposalId) {
    if (barrierState.proposalId && barrierState.proposalId !== proposalId) {
      // Trying to clear a different live proposalId - ignore!
      return;
    }
    resolvedProposalIds.add(proposalId);
  } else if (barrierState.proposalId) {
    resolvedProposalIds.add(barrierState.proposalId);
  }

  clearBarrierTimer();

  barrierState = {
    active: false,
    proposalId: null,
    targetBuild: null,
    phase: null,
    expiresAt: null,
  };

  notifyBarrierListeners();
  notifyActivityListeners();
}

/**
 * Check if activation barrier is active.
 */
export function isActivationBarrierActive(): boolean {
  return barrierState.active;
}

/**
 * Get current activation barrier state.
 */
export function getActivationBarrierState(): ActivationBarrierState {
  return { ...barrierState };
}

/**
 * Bridge for simple boolean activation barrier setter.
 */
export function setActivationBarrier(active: boolean): void {
  if (active) {
    if (!barrierState.active) {
      const defaultId = `manual_barrier_${Date.now()}`;
      openActivationBarrier({
        proposalId: defaultId,
        targetBuild: "manual",
        expiresAt: Date.now() + 30_000,
        phase: "preparing",
      });
    }
  } else {
    clearActivationBarrier();
  }
}

/**
 * Atomic hazard token acquisition.
 * Checks barrier and registers token in a single synchronous function (no await).
 * Returns cleanup function if token acquired, or null if barrier is active.
 */
export function tryAcquireConversationHazard(
  source: ConversationSource,
  reason: string,
): (() => void) | null {
  if (isActivationBarrierActive()) {
    return null;
  }
  return acquireHazardToken(source, reason);
}

/**
 * Acquire a hazard token for a specific source and reason.
 * Returns an idempotent cleanup function that releases the token.
 */
export function acquireHazardToken(
  source: ConversationSource,
  reason: string,
): () => void {
  hasPublishedEver = true;
  tokenIdCounter += 1;
  const id = `token_${tokenIdCounter}_${source}_${reason}`;
  hazardTokens.set(id, { id, source, reason });
  notifyActivityListeners();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    hazardTokens.delete(id);
    notifyActivityListeners();
  };
}

/**
 * Release all tokens matching (source, reason).
 */
export function releaseHazardToken(
  source: ConversationSource,
  reason: string,
): void {
  let changed = false;
  for (const [id, token] of Array.from(hazardTokens.entries())) {
    if (token.source === source && token.reason === reason) {
      hazardTokens.delete(id);
      changed = true;
    }
  }
  if (changed) {
    notifyActivityListeners();
  }
}

/**
 * Set page activity readiness state.
 */
export function setConversationActivityReady(ready: boolean): void {
  if (isReadyState === ready) return;
  isReadyState = ready;
  notifyActivityListeners();
}

/**
 * Check if any conversation source has active hazards.
 */
export function isConversationActive(): boolean {
  return hazardTokens.size > 0;
}

/**
 * Get current conversation activity snapshot.
 */
export function getConversationActivitySnapshot(): ConversationActivitySnapshot {
  const hazards = computeHazards();
  const isAnyActive = hazardTokens.size > 0;
  return {
    ready: isReadyState,
    hazards,
    isAnyActive,
    activationBarrier: barrierState.active,
  };
}

/**
 * Check if activity has ever been published or interacted with.
 */
export function hasActivityBeenPublished(): boolean {
  return hasPublishedEver;
}

/**
 * Legacy compatibility wrapper: publish conversation activity for a source.
 * acquire hazard token if active is true, release if false.
 */
export function publishConversationActivity(
  source: ConversationSource,
  active: boolean,
): void {
  hasPublishedEver = true;
  if (active) {
    const existing = Array.from(hazardTokens.values()).find(
      (t) => t.source === source && t.reason === "active",
    );
    if (!existing) {
      acquireHazardToken(source, "active");
    }
  } else {
    releaseHazardToken(source, "active");
  }
}

/**
 * Subscribe to conversation activity snapshot changes.
 */
export function subscribeConversationActivity(
  listener: ConversationActivityListener,
): () => void {
  activityListeners.add(listener);
  try {
    listener(getConversationActivitySnapshot());
  } catch (e) {
    console.error("[conversationActivity] Listener error on subscribe:", e);
  }

  return () => {
    activityListeners.delete(listener);
  };
}

/**
 * Subscribe to activation barrier state changes.
 */
export function subscribeActivationBarrier(
  listener: ActivationBarrierListener,
): () => void {
  barrierListeners.add(listener);
  try {
    listener({ ...barrierState });
  } catch (e) {
    console.error("[conversationActivity] Barrier listener error on subscribe:", e);
  }

  return () => {
    barrierListeners.delete(listener);
  };
}

/**
 * Reset store for tests.
 */
export function _resetConversationActivityStoreForTest(): void {
  clearBarrierTimer();
  hazardTokens.clear();
  activityListeners.clear();
  barrierListeners.clear();
  resolvedProposalIds.clear();
  barrierState = {
    active: false,
    proposalId: null,
    targetBuild: null,
    phase: null,
    expiresAt: null,
  };
  isReadyState = false;
  hasPublishedEver = false;
  tokenIdCounter = 0;
}
