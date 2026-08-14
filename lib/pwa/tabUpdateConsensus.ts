import {
  ActivationProposal,
  parseActivationProposal,
  isValidUuid,
  isPwaGetIdentityRequest,
  isPwaIdentityResponse,
  isPwaPrepareActivationRequest,
  isPwaTabPrepareRequest,
  isPwaTabVoteAckResponse,
  isPwaTabVoteNackResponse,
  isStrictPwaTabVoteAck,
  isStrictPwaTabVoteNack,
  isPwaActivationCommittedNotice,
  isPwaActivationAbortedNotice,
  isValidStaleAssetPath,
  validateStaleAssetEnvelope,
  requestServiceWorkerIdentity,
  requestActivationViaChannel,
  PwaIdentityResponse,
  PwaTabVoteAckResponse,
  PwaTabVoteNackResponse,
  NackStatus,
  StaleAssetEnvelope,
} from "./swProtocol";
import {
  LatestVersionMetadataV1,
  parseLatestVersionMetadata,
} from "./clientVersion";
import {
  getConversationActivitySnapshot,
  getActivationBarrierState,
  isActivationBarrierActive,
} from "./conversationActivity";
import {
  getRouteReadinessSnapshot,
  isCurrentRouteSafeAndReady,
  isSafeRoutePath,
} from "./routeReadiness";

export const PWA_ACTIVATION_PROPOSAL_STORAGE_KEY = "k_pwa_activation_proposal_v1";
export const PWA_TAB_ID_STORAGE_KEY = "k_pwa_tab_id_v1";
export const PWA_UPDATE_BROADCAST_CHANNEL_NAME = "kbestie:pwa-update:v1";
export const PROPOSAL_DEFAULT_TTL_MS = 30_000;

export const DEFAULT_SAFE_ROUTES = [
  "/",
  "/child/home",
  "/parent/home",
  "/login",
  "/offline",
] as const;

export {
  parseActivationProposal,
  isValidUuid,
  isPwaGetIdentityRequest,
  isPwaIdentityResponse,
  isPwaPrepareActivationRequest,
  isPwaTabPrepareRequest,
  isPwaTabVoteAckResponse,
  isPwaTabVoteNackResponse,
  isStrictPwaTabVoteAck,
  isStrictPwaTabVoteNack,
  isPwaActivationCommittedNotice,
  isPwaActivationAbortedNotice,
  isValidStaleAssetPath,
  validateStaleAssetEnvelope,
  requestServiceWorkerIdentity,
  requestActivationViaChannel,
  isSafeRoutePath,
};

export type {
  ActivationProposal,
  PwaIdentityResponse,
  PwaTabVoteAckResponse,
  PwaTabVoteNackResponse,
  NackStatus,
  StaleAssetEnvelope,
};

export interface ActivationProposalLease {
  schemaVersion: 1;
  proposalId: string;
  ownerTabId: string;
  target: LatestVersionMetadataV1;
  workerNonce: string;
  createdAt: number;
  expiresAt: number;
  fromBuild?: string;
  targetBuild?: string;
  targetSwVersion?: string;
  targetScriptUrl?: string;
}

export function parseActivationProposalLease(
  raw: unknown,
  now = Date.now()
): ActivationProposal | null {
  if (!raw) return null;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  // Must match either protocol: 1 or schemaVersion: 1
  if (obj.protocol !== 1 && obj.schemaVersion !== 1) return null;
  if (typeof obj.proposalId !== "string" || !isValidUuid(obj.proposalId)) return null;
  if (typeof obj.ownerTabId !== "string" || !isValidUuid(obj.ownerTabId)) return null;
  if (typeof obj.workerNonce !== "string" || !obj.workerNonce.trim()) return null;

  let validatedTarget: LatestVersionMetadataV1 | undefined = undefined;
  if (obj.target !== undefined && obj.target !== null) {
    const res = parseLatestVersionMetadata(obj.target);
    if (!res) return null;
    validatedTarget = res;
  }

  const rawTargetBuild = typeof obj.targetBuild === "string" ? obj.targetBuild.trim() : "";
  const targetBuild = rawTargetBuild || (validatedTarget ? validatedTarget.buildId : "");
  if (!targetBuild) return null;

  if (typeof obj.createdAt !== "number" || !Number.isFinite(obj.createdAt) || obj.createdAt <= 0) {
    return null;
  }
  if (
    typeof obj.expiresAt !== "number" ||
    !Number.isFinite(obj.expiresAt) ||
    obj.expiresAt <= obj.createdAt
  ) {
    return null;
  }

  if (now >= obj.expiresAt) {
    return null;
  }

  const fromBuild =
    typeof obj.fromBuild === "string" && obj.fromBuild.trim() ? obj.fromBuild.trim() : undefined;
  const targetSwVersion =
    typeof obj.targetSwVersion === "string" && obj.targetSwVersion.trim()
      ? obj.targetSwVersion.trim()
      : validatedTarget
      ? validatedTarget.swVersion
      : undefined;
  const targetScriptUrl =
    typeof obj.targetScriptUrl === "string" && obj.targetScriptUrl.trim()
      ? obj.targetScriptUrl.trim()
      : typeof obj.serviceWorkerScriptUrl === "string" && obj.serviceWorkerScriptUrl.trim()
      ? obj.serviceWorkerScriptUrl.trim()
      : validatedTarget
      ? validatedTarget.serviceWorkerScriptUrl
      : undefined;

  const result: ActivationProposal = {
    protocol: 1,
    proposalId: obj.proposalId.trim(),
    ownerTabId: obj.ownerTabId.trim(),
    targetBuild,
    workerNonce: obj.workerNonce.trim(),
    createdAt: obj.createdAt,
    expiresAt: obj.expiresAt,
  };

  if (fromBuild) result.fromBuild = fromBuild;
  if (targetSwVersion) result.targetSwVersion = targetSwVersion;
  if (targetScriptUrl) {
    result.targetScriptUrl = targetScriptUrl;
    result.serviceWorkerScriptUrl = targetScriptUrl;
  }
  if (validatedTarget) result.target = validatedTarget;

  return result;
}

export function isEquivalentTarget(
  targetA?: LatestVersionMetadataV1 | null,
  buildA?: string | null,
  targetB?: LatestVersionMetadataV1 | null,
  buildB?: string | null
): boolean {
  if (targetA && targetB) {
    return (
      targetA.schemaVersion === targetB.schemaVersion &&
      targetA.buildId === targetB.buildId &&
      targetA.buildStamp === targetB.buildStamp &&
      targetA.deploymentId === targetB.deploymentId &&
      targetA.swVersion === targetB.swVersion &&
      targetA.serviceWorkerScriptUrl === targetB.serviceWorkerScriptUrl
    );
  }
  const b1 = (targetA ? targetA.buildId : buildA) || "";
  const b2 = (targetB ? targetB.buildId : buildB) || "";
  return b1.trim() !== "" && b1.trim() === b2.trim();
}

export function getActivationProposal(
  storage?: Storage | null,
  now = Date.now()
): ActivationProposal | null {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return null;

  try {
    const raw = store.getItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
    if (!raw) return null;
    const proposal = parseActivationProposalLease(raw, now);
    if (!proposal) {
      // Auto cleanup expired or malformed
      store.removeItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
      return null;
    }
    return proposal;
  } catch {
    return null;
  }
}

export function clearActivationProposal(
  storage?: Storage | null,
  ownerTabId?: string,
  proposalId?: string,
  now = Date.now()
): boolean {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return false;

  try {
    const raw = store.getItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
    if (!raw) return true;
    const existing = parseActivationProposalLease(raw, now);
    if (existing) {
      if (proposalId && existing.proposalId !== proposalId) {
        return false;
      }
      if (ownerTabId && existing.ownerTabId !== ownerTabId) {
        return false;
      }
    }
    store.removeItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function abortActivationProposal(
  proposalId: string,
  ownerTabId: string,
  storage?: Storage | null,
  now = Date.now()
): boolean {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return false;

  const existing = getActivationProposal(store, now);
  if (!existing) return false;
  if (existing.proposalId !== proposalId) return false;
  if (existing.ownerTabId !== ownerTabId) return false;

  store.removeItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
  return true;
}

export function commitActivationProposal(
  proposalId: string,
  ownerTabId: string,
  storage?: Storage | null,
  now = Date.now()
): boolean {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return false;

  const existing = getActivationProposal(store, now);
  if (!existing) return false;
  if (existing.proposalId !== proposalId) return false;
  if (existing.ownerTabId !== ownerTabId) return false;

  return true;
}

export interface CreateProposalParams {
  ownerTabId: string;
  target?: LatestVersionMetadataV1;
  targetBuild?: string;
  workerNonce: string;
  fromBuild?: string;
  targetSwVersion?: string;
  targetScriptUrl?: string;
  serviceWorkerScriptUrl?: string;
  ttlMs?: number;
}

export function createActivationProposal(
  params: CreateProposalParams,
  storage?: Storage | null,
  now = Date.now()
): ActivationProposal | null {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return null;

  const {
    ownerTabId,
    target,
    workerNonce,
    fromBuild,
    ttlMs = PROPOSAL_DEFAULT_TTL_MS,
  } = params;

  if (!isValidUuid(ownerTabId) || !workerNonce?.trim()) {
    return null;
  }

  let validatedTarget: LatestVersionMetadataV1 | undefined = undefined;
  if (target) {
    const res = parseLatestVersionMetadata(target);
    if (!res) return null;
    validatedTarget = res;
  }

  const rawTargetBuild = params.targetBuild?.trim() || (validatedTarget ? validatedTarget.buildId : "");
  if (!rawTargetBuild) {
    return null;
  }

  const targetSwVersion =
    params.targetSwVersion?.trim() || (validatedTarget ? validatedTarget.swVersion : undefined);
  const targetScriptUrl =
    params.targetScriptUrl?.trim() ||
    params.serviceWorkerScriptUrl?.trim() ||
    (validatedTarget ? validatedTarget.serviceWorkerScriptUrl : undefined);

  // Check existing unexpired lease in storage
  const existing = getActivationProposal(store, now);
  if (existing && now < existing.expiresAt) {
    // 1. Same exact target + workerNonce -> REUSE EXISTING LEASE!
    const isTargetSame = isEquivalentTarget(
      existing.target,
      existing.targetBuild,
      validatedTarget,
      rawTargetBuild
    );
    const isNonceSame = existing.workerNonce.trim() === workerNonce.trim();

    if (isTargetSame && isNonceSame) {
      return existing;
    }

    // 2. Different target or workerNonce -> MUST WAIT until abort or expiry!
    return null;
  }

  // 3. No active lease or expired -> Create fresh proposal with CAS write & read-back
  const proposalId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "";
  if (!proposalId) return null;

  const proposal: ActivationProposal = {
    protocol: 1,
    proposalId,
    ownerTabId,
    fromBuild: fromBuild?.trim() || undefined,
    targetBuild: rawTargetBuild,
    targetSwVersion: targetSwVersion || undefined,
    targetScriptUrl: targetScriptUrl || undefined,
    serviceWorkerScriptUrl: targetScriptUrl || undefined,
    target: validatedTarget,
    workerNonce: workerNonce.trim(),
    createdAt: now,
    expiresAt: now + ttlMs,
  };

  try {
    const json = JSON.stringify(proposal);
    store.setItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY, json);

    // Strict CAS read-back
    const readBack = store.getItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
    if (!readBack) return null;

    const parsed = parseActivationProposalLease(readBack, now);
    if (
      !parsed ||
      parsed.proposalId !== proposalId ||
      parsed.ownerTabId !== ownerTabId ||
      parsed.workerNonce !== workerNonce.trim()
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function getOrCreateTabId(storage?: Storage | null): string {
  const store = storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  if (store) {
    try {
      const existing = store.getItem(PWA_TAB_ID_STORAGE_KEY);
      if (existing && isValidUuid(existing)) {
        return existing;
      }
    } catch {}
  }

  const newId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "";
  if (store && newId) {
    try {
      store.setItem(PWA_TAB_ID_STORAGE_KEY, newId);
    } catch {}
  }
  return newId;
}

export interface BroadcastHintMessage {
  protocol: 1;
  type: "PWA_PROPOSAL_BROADCAST_HINT";
  proposal: ActivationProposal;
  senderTabId: string;
}

export function broadcastProposalHint(proposal: ActivationProposal, tabId: string): void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
  try {
    const channel = new BroadcastChannel(PWA_UPDATE_BROADCAST_CHANNEL_NAME);
    const message: BroadcastHintMessage = {
      protocol: 1,
      type: "PWA_PROPOSAL_BROADCAST_HINT",
      proposal,
      senderTabId: tabId,
    };
    channel.postMessage(message);
    channel.close();
  } catch {}
}

export function subscribeProposalHint(
  callback: (proposal: ActivationProposal) => void
): () => void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return () => {};
  }
  try {
    const channel = new BroadcastChannel(PWA_UPDATE_BROADCAST_CHANNEL_NAME);
    const handler = (event: MessageEvent) => {
      const data = event.data as Partial<BroadcastHintMessage> | null;
      if (
        data &&
        data.protocol === 1 &&
        data.type === "PWA_PROPOSAL_BROADCAST_HINT" &&
        data.proposal
      ) {
        const proposal = parseActivationProposalLease(data.proposal);
        if (proposal) {
          callback(proposal);
        }
      }
    };
    channel.addEventListener("message", handler);
    return () => {
      channel.removeEventListener("message", handler);
      channel.close();
    };
  } catch {
    return () => {};
  }
}

export interface EvaluateTabVoteParams {
  clientId?: string;
  requestNonce: string;
  passId?: string;
  voteNonce?: string;
  proposal: ActivationProposal;
  pathname: string;
  isReactReady?: boolean;
  isActivityReady?: boolean;
  isNavigationInFlight?: boolean;
  isConversationActive: boolean;
  hazardsCount?: number;
  documentBuildId: string;
  activeProposalId?: string | null;
  now?: number;
}

export function evaluateTabVote(
  params: EvaluateTabVoteParams
): PwaTabVoteAckResponse | PwaTabVoteNackResponse {
  const {
    requestNonce,
    passId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "",
    voteNonce = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "",
    proposal,
    pathname,
    isReactReady = params.isReactReady !== undefined
      ? params.isReactReady
      : typeof window !== "undefined"
      ? isCurrentRouteSafeAndReady(pathname)
      : true,
    isActivityReady = params.isActivityReady !== undefined
      ? params.isActivityReady
      : getConversationActivitySnapshot().ready,
    isNavigationInFlight = params.isNavigationInFlight !== undefined
      ? params.isNavigationInFlight
      : getRouteReadinessSnapshot().isNavigationInFlight,
    isConversationActive,
    hazardsCount = 0,
    documentBuildId,
    activeProposalId,
    now = Date.now(),
  } = params;

  const validProposal = parseActivationProposalLease(proposal, now);
  if (!validProposal) {
    return {
      protocol: 1,
      type: "PWA_TAB_VOTE_NACK",
      requestNonce,
      proposalId: proposal?.proposalId || "",
      passId,
      voteNonce,
      targetBuild: proposal?.targetBuild,
      targetSwVersion: proposal?.targetSwVersion,
      workerNonce: proposal?.workerNonce,
      status: "NACK_EXPIRED",
      reason: "Proposal expired or malformed",
    };
  }

  if (activeProposalId && activeProposalId !== validProposal.proposalId) {
    return {
      protocol: 1,
      type: "PWA_TAB_VOTE_NACK",
      requestNonce,
      proposalId: validProposal.proposalId,
      passId,
      voteNonce,
      targetBuild: validProposal.targetBuild,
      targetSwVersion: validProposal.targetSwVersion,
      workerNonce: validProposal.workerNonce,
      status: "NACK_MISMATCH",
      reason: "Active proposal ID mismatch",
    };
  }

  if (validProposal.fromBuild && validProposal.fromBuild.trim() !== documentBuildId.trim()) {
    return {
      protocol: 1,
      type: "PWA_TAB_VOTE_NACK",
      requestNonce,
      proposalId: validProposal.proposalId,
      passId,
      voteNonce,
      targetBuild: validProposal.targetBuild,
      targetSwVersion: validProposal.targetSwVersion,
      workerNonce: validProposal.workerNonce,
      status: "NACK_MISMATCH",
      reason: "Document build mismatch",
    };
  }

  if (isConversationActive || hazardsCount > 0) {
    return {
      protocol: 1,
      type: "PWA_TAB_VOTE_NACK",
      requestNonce,
      proposalId: validProposal.proposalId,
      passId,
      voteNonce,
      targetBuild: validProposal.targetBuild,
      targetSwVersion: validProposal.targetSwVersion,
      workerNonce: validProposal.workerNonce,
      status: "NACK_ACTIVE",
      reason: "Conversation hazard active",
    };
  }

  const routeSafe = isSafeRoutePath(pathname);
  const routeReady = routeSafe && isReactReady && isActivityReady && !isNavigationInFlight;

  if (!routeReady) {
    return {
      protocol: 1,
      type: "PWA_TAB_VOTE_NACK",
      requestNonce,
      proposalId: validProposal.proposalId,
      passId,
      voteNonce,
      targetBuild: validProposal.targetBuild,
      targetSwVersion: validProposal.targetSwVersion,
      workerNonce: validProposal.workerNonce,
      status: "NACK_NOT_READY",
      reason: "Route is not safe or ready",
    };
  }

  return {
    protocol: 1,
    type: "PWA_TAB_VOTE_ACK",
    requestNonce,
    proposalId: validProposal.proposalId,
    passId,
    voteNonce,
    targetBuild: validProposal.targetBuild,
    targetSwVersion: validProposal.targetSwVersion,
    workerNonce: validProposal.workerNonce,
    status: "ACK_SAFE",
  };
}
