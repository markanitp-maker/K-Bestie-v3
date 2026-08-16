import { isRouteReady } from "./updateGate";
import { openActivationBarrier } from "./conversationActivity";
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
  isValidStaleAssetPath,
  validateStaleAssetEnvelope,
  PwaIdentityResponse,
  PwaTabVoteAckResponse,
  PwaTabVoteNackResponse,
  NackStatus,
  StaleAssetEnvelope,
} from "./swProtocol";

export const PWA_ACTIVATION_PROPOSAL_STORAGE_KEY = "k_pwa_activation_proposal_v1";
export const PWA_TAB_ID_STORAGE_KEY = "k_pwa_tab_id_v1";
export const PWA_UPDATE_BROADCAST_CHANNEL_NAME = "kbestie:pwa-update:v1";
export const PROPOSAL_DEFAULT_TTL_MS = 30_000;

export {
  parseActivationProposal,
  isValidUuid,
  isPwaGetIdentityRequest,
  isPwaIdentityResponse,
  isPwaPrepareActivationRequest,
  isPwaTabPrepareRequest,
  isPwaTabVoteAckResponse,
  isPwaTabVoteNackResponse,
  isValidStaleAssetPath,
  validateStaleAssetEnvelope,
};

export type {
  ActivationProposal,
  PwaIdentityResponse,
  PwaTabVoteAckResponse,
  PwaTabVoteNackResponse,
  NackStatus,
  StaleAssetEnvelope,
};

export function getActivationProposal(
  storage?: Storage | null,
  now = Date.now()
): ActivationProposal | null {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return null;

  try {
    const raw = store.getItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
    if (!raw) return null;
    const proposal = parseActivationProposal(raw, now);
    if (!proposal) {
      store.removeItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
      return null;
    }
    return proposal;
  } catch {
    return null;
  }
}

export function clearActivationProposal(storage?: Storage | null): void {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return;
  try {
    store.removeItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
  } catch {}
}

export interface CreateProposalParams {
  ownerTabId: string;
  targetBuild: string;
  workerNonce: string;
  fromBuild?: string;
  targetSwVersion?: string;
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
    targetBuild,
    workerNonce,
    fromBuild,
    targetSwVersion,
    ttlMs = PROPOSAL_DEFAULT_TTL_MS,
  } = params;

  if (!isValidUuid(ownerTabId) || !targetBuild?.trim() || !workerNonce?.trim()) {
    return null;
  }

  const existing = getActivationProposal(store, now);
  if (existing && now < existing.expiresAt) {
    if (existing.ownerTabId !== ownerTabId) {
      return null;
    }
  }

  const proposalId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "";
  if (!proposalId) return null;

  const proposal: ActivationProposal = {
    protocol: 1,
    proposalId,
    ownerTabId,
    fromBuild: fromBuild?.trim() || undefined,
    targetBuild: targetBuild.trim(),
    targetSwVersion: targetSwVersion?.trim() || undefined,
    workerNonce: workerNonce.trim(),
    createdAt: now,
    expiresAt: now + ttlMs,
  };

  try {
    const json = JSON.stringify(proposal);
    store.setItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY, json);

    const verified = store.getItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
    if (!verified) return null;

    const parsed = parseActivationProposal(verified, now);
    if (!parsed || parsed.proposalId !== proposalId) {
      return null;
    }

    openActivationBarrier(
      {
        proposalId: parsed.proposalId,
        targetBuild: parsed.targetBuild,
        expiresAt: parsed.expiresAt,
        phase: "preparing",
      },
      now
    );

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
      if (data && data.protocol === 1 && data.type === "PWA_PROPOSAL_BROADCAST_HINT" && data.proposal) {
        const proposal = parseActivationProposal(data.proposal);
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
    isReactReady = true,
    isActivityReady = true,
    isNavigationInFlight = false,
    isConversationActive,
    hazardsCount = 0,
    documentBuildId,
    activeProposalId,
    now = Date.now(),
  } = params;

  const validProposal = parseActivationProposal(proposal, now);
  if (!validProposal) {
    return {
      protocol: 1,
      type: "PWA_TAB_NACK",
      requestNonce,
      proposalId: proposal?.proposalId || "",
      passId,
      voteNonce,
      status: "NACK_EXPIRED",
      reason: "Proposal expired or malformed",
    };
  }

  // Open barrier synchronously upon receiving proposal before reading hazards/readiness
  openActivationBarrier(
    {
      proposalId: validProposal.proposalId,
      targetBuild: validProposal.targetBuild,
      expiresAt: validProposal.expiresAt,
      phase: "preparing",
    },
    now
  );

  if (activeProposalId && activeProposalId !== validProposal.proposalId) {
    return {
      protocol: 1,
      type: "PWA_TAB_NACK",
      requestNonce,
      proposalId: validProposal.proposalId,
      passId,
      voteNonce,
      status: "NACK_MISMATCH",
      reason: "Active proposal ID mismatch",
    };
  }

  if (validProposal.fromBuild && validProposal.fromBuild.trim() !== documentBuildId.trim()) {
    return {
      protocol: 1,
      type: "PWA_TAB_NACK",
      requestNonce,
      proposalId: validProposal.proposalId,
      passId,
      voteNonce,
      status: "NACK_MISMATCH",
      reason: "Document build mismatch",
    };
  }

  if (isConversationActive || hazardsCount > 0) {
    return {
      protocol: 1,
      type: "PWA_TAB_NACK",
      requestNonce,
      proposalId: validProposal.proposalId,
      passId,
      voteNonce,
      status: "NACK_ACTIVE",
      reason: "Conversation hazard active",
    };
  }

  const routeReady = isRouteReady({
    pathname,
    isReactReady,
    isActivityReady,
    isNavigationInFlight,
  });

  if (!routeReady) {
    return {
      protocol: 1,
      type: "PWA_TAB_NACK",
      requestNonce,
      proposalId: validProposal.proposalId,
      passId,
      voteNonce,
      status: "NACK_NOT_READY",
      reason: "Route is not safe or ready",
    };
  }

  return {
    protocol: 1,
    type: "PWA_TAB_ACK",
    requestNonce,
    proposalId: validProposal.proposalId,
    passId,
    voteNonce,
    status: "ACK_SAFE",
  };
}
