export const SW_PROTOCOL_VERSION = 1;

export interface ActivationProposal {
  protocol: 1;
  proposalId: string;
  ownerTabId: string;
  fromBuild?: string;
  targetBuild: string;
  targetSwVersion?: string;
  workerNonce: string;
  createdAt: number;
  expiresAt: number;
}

export function hasOnlyAllowedKeys(obj: object, allowedKeys: readonly string[]): boolean {
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (!allowedKeys.includes(key)) {
      return false;
    }
  }
  return true;
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidUuid(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  return UUID_REGEX.test(id.trim());
}

const PROPOSAL_ALLOWED_KEYS = [
  "protocol",
  "proposalId",
  "ownerTabId",
  "fromBuild",
  "targetBuild",
  "targetSwVersion",
  "workerNonce",
  "createdAt",
  "expiresAt",
] as const;

export function parseActivationProposal(
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

  if (!hasOnlyAllowedKeys(obj, PROPOSAL_ALLOWED_KEYS)) return null;

  if (obj.protocol !== 1) return null;
  if (typeof obj.proposalId !== "string" || !isValidUuid(obj.proposalId)) return null;
  if (typeof obj.ownerTabId !== "string" || !isValidUuid(obj.ownerTabId)) return null;
  if (typeof obj.targetBuild !== "string" || !obj.targetBuild.trim()) return null;
  if (typeof obj.workerNonce !== "string" || !obj.workerNonce.trim()) return null;

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
      : undefined;

  return {
    protocol: 1,
    proposalId: obj.proposalId.trim(),
    ownerTabId: obj.ownerTabId.trim(),
    fromBuild,
    targetBuild: obj.targetBuild.trim(),
    targetSwVersion,
    workerNonce: obj.workerNonce.trim(),
    createdAt: obj.createdAt,
    expiresAt: obj.expiresAt,
  };
}

export interface PwaGetIdentityRequest {
  protocol: 1;
  type: "PWA_GET_IDENTITY";
  requestNonce: string;
}

const GET_IDENTITY_REQ_ALLOWED_KEYS = ["protocol", "type", "requestNonce"] as const;

export function isPwaGetIdentityRequest(data: unknown): data is PwaGetIdentityRequest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(obj, GET_IDENTITY_REQ_ALLOWED_KEYS)) return false;
  return (
    obj.protocol === 1 &&
    obj.type === "PWA_GET_IDENTITY" &&
    typeof obj.requestNonce === "string" &&
    obj.requestNonce.trim().length > 0
  );
}

export interface PwaIdentityResponse {
  protocol: 1;
  type: "PWA_IDENTITY_RESPONSE";
  requestNonce: string;
  buildId: string;
  swVersion: string;
  workerNonce: string;
}

const IDENTITY_RES_ALLOWED_KEYS = [
  "protocol",
  "type",
  "requestNonce",
  "buildId",
  "swVersion",
  "workerNonce",
] as const;

export function isPwaIdentityResponse(
  data: unknown,
  expectedRequestNonce?: string
): data is PwaIdentityResponse {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(obj, IDENTITY_RES_ALLOWED_KEYS)) return false;
  if (obj.protocol !== 1 || obj.type !== "PWA_IDENTITY_RESPONSE") return false;
  if (typeof obj.requestNonce !== "string" || !obj.requestNonce.trim()) return false;
  if (expectedRequestNonce && obj.requestNonce.trim() !== expectedRequestNonce.trim()) return false;
  if (typeof obj.buildId !== "string" || !obj.buildId.trim()) return false;
  if (typeof obj.swVersion !== "string" || !obj.swVersion.trim()) return false;
  if (typeof obj.workerNonce !== "string" || !obj.workerNonce.trim()) return false;
  return true;
}

export interface ServiceWorkerIdentity {
  protocolVersion: 0 | 1;
  buildId: string;
  swVersion: string;
  workerNonce: string | null;
}

export interface PwaPrepareActivationRequest {
  protocol: 1;
  type: "PWA_PREPARE_ACTIVATION";
  requestNonce: string;
  proposal: ActivationProposal;
}

const PREPARE_ACTIVATION_ALLOWED_KEYS = ["protocol", "type", "requestNonce", "proposal"] as const;

export function isPwaPrepareActivationRequest(data: unknown): data is PwaPrepareActivationRequest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(obj, PREPARE_ACTIVATION_ALLOWED_KEYS)) return false;
  if (obj.protocol !== 1 || obj.type !== "PWA_PREPARE_ACTIVATION") return false;
  if (typeof obj.requestNonce !== "string" || !obj.requestNonce.trim()) return false;
  const proposal = parseActivationProposal(obj.proposal);
  return proposal !== null;
}

export interface PwaTabPrepareRequest {
  protocol: 1;
  type: "PWA_TAB_PREPARE";
  requestNonce: string;
  proposal: ActivationProposal;
  passId: string;
  voteNonce: string;
  targetBuild: string;
  targetSwVersion: string;
  workerNonce: string;
  expiresAt: number;
}

const TAB_PREPARE_ALLOWED_KEYS = [
  "protocol",
  "type",
  "requestNonce",
  "proposal",
  "passId",
  "voteNonce",
  "targetBuild",
  "targetSwVersion",
  "workerNonce",
  "expiresAt",
] as const;

export function isPwaTabPrepareRequest(data: unknown): data is PwaTabPrepareRequest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(obj, TAB_PREPARE_ALLOWED_KEYS)) return false;
  if (obj.protocol !== 1 || obj.type !== "PWA_TAB_PREPARE") return false;
  if (typeof obj.requestNonce !== "string" || !obj.requestNonce.trim()) return false;
  if (typeof obj.passId !== "string" || !isValidUuid(obj.passId)) return false;
  if (typeof obj.voteNonce !== "string" || !isValidUuid(obj.voteNonce)) return false;
  if (typeof obj.targetBuild !== "string" || !obj.targetBuild.trim()) return false;
  if (typeof obj.targetSwVersion !== "string" || !obj.targetSwVersion.trim()) return false;
  if (typeof obj.workerNonce !== "string" || !obj.workerNonce.trim()) return false;
  if (typeof obj.expiresAt !== "number" || !Number.isFinite(obj.expiresAt)) return false;
  const proposal = parseActivationProposal(obj.proposal);
  return proposal !== null;
}

export interface PwaTabVoteAckResponse {
  protocol: 1;
  type: "PWA_TAB_ACK" | "PWA_TAB_VOTE_ACK";
  requestNonce: string;
  proposalId: string;
  passId: string;
  voteNonce: string;
  status: "ACK_SAFE";
}

const VOTE_ACK_ALLOWED_KEYS = [
  "protocol",
  "type",
  "requestNonce",
  "proposalId",
  "passId",
  "voteNonce",
  "status",
] as const;

export function isPwaTabVoteAckResponse(data: unknown): data is PwaTabVoteAckResponse {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(obj, VOTE_ACK_ALLOWED_KEYS)) return false;
  return (
    obj.protocol === 1 &&
    (obj.type === "PWA_TAB_ACK" || obj.type === "PWA_TAB_VOTE_ACK") &&
    typeof obj.requestNonce === "string" &&
    typeof obj.proposalId === "string" &&
    isValidUuid(obj.proposalId) &&
    typeof obj.passId === "string" &&
    isValidUuid(obj.passId) &&
    typeof obj.voteNonce === "string" &&
    isValidUuid(obj.voteNonce) &&
    obj.status === "ACK_SAFE"
  );
}

export type NackStatus =
  | "NACK_ACTIVE"
  | "NACK_NOT_READY"
  | "NACK_MISMATCH"
  | "NACK_EXPIRED"
  | "NACK_ERROR";

export interface PwaTabVoteNackResponse {
  protocol: 1;
  type: "PWA_TAB_NACK" | "PWA_TAB_VOTE_NACK";
  requestNonce: string;
  proposalId: string;
  passId: string;
  voteNonce: string;
  status: NackStatus;
  reason?: string;
}

const VOTE_NACK_ALLOWED_KEYS = [
  "protocol",
  "type",
  "requestNonce",
  "proposalId",
  "passId",
  "voteNonce",
  "status",
  "reason",
] as const;

export function isPwaTabVoteNackResponse(data: unknown): data is PwaTabVoteNackResponse {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(obj, VOTE_NACK_ALLOWED_KEYS)) return false;
  const validStatuses: NackStatus[] = [
    "NACK_ACTIVE",
    "NACK_NOT_READY",
    "NACK_MISMATCH",
    "NACK_EXPIRED",
    "NACK_ERROR",
  ];
  return (
    obj.protocol === 1 &&
    (obj.type === "PWA_TAB_NACK" || obj.type === "PWA_TAB_VOTE_NACK") &&
    typeof obj.requestNonce === "string" &&
    typeof obj.proposalId === "string" &&
    isValidUuid(obj.proposalId) &&
    typeof obj.passId === "string" &&
    isValidUuid(obj.passId) &&
    typeof obj.voteNonce === "string" &&
    isValidUuid(obj.voteNonce) &&
    typeof obj.status === "string" &&
    validStatuses.includes(obj.status as NackStatus)
  );
}

export interface PwaActivationAbortedNotice {
  protocol: 1;
  type: "PWA_ACTIVATION_ABORTED";
  requestNonce: string;
  proposalId: string;
  reason: string;
}

const ABORTED_ALLOWED_KEYS = ["protocol", "type", "requestNonce", "proposalId", "reason"] as const;

export function isPwaActivationAbortedNotice(data: unknown): data is PwaActivationAbortedNotice {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(obj, ABORTED_ALLOWED_KEYS)) return false;
  return (
    obj.protocol === 1 &&
    obj.type === "PWA_ACTIVATION_ABORTED" &&
    typeof obj.requestNonce === "string" &&
    typeof obj.proposalId === "string" &&
    isValidUuid(obj.proposalId) &&
    typeof obj.reason === "string"
  );
}

export interface PwaActivationCommittedNotice {
  protocol: 1;
  type: "PWA_ACTIVATION_COMMITTED";
  requestNonce: string;
  proposalId: string;
  workerNonce: string;
}

const COMMITTED_ALLOWED_KEYS = [
  "protocol",
  "type",
  "requestNonce",
  "proposalId",
  "workerNonce",
] as const;

export function isPwaActivationCommittedNotice(
  data: unknown
): data is PwaActivationCommittedNotice {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(obj, COMMITTED_ALLOWED_KEYS)) return false;
  return (
    obj.protocol === 1 &&
    obj.type === "PWA_ACTIVATION_COMMITTED" &&
    typeof obj.requestNonce === "string" &&
    typeof obj.proposalId === "string" &&
    isValidUuid(obj.proposalId) &&
    typeof obj.workerNonce === "string" &&
    obj.workerNonce.trim().length > 0
  );
}

export interface StaleAssetEnvelope {
  protocol: 1;
  type: "K_STALE_ASSET";
  requestNonce: string;
  buildId: string;
  workerNonce: string;
  pathname: string;
  status: 404;
}

const STALE_ASSET_ALLOWED_KEYS = [
  "protocol",
  "type",
  "requestNonce",
  "buildId",
  "workerNonce",
  "pathname",
  "status",
] as const;

export function isValidStaleAssetPath(pathname: string): boolean {
  if (typeof pathname !== "string") return false;
  if (!pathname.startsWith("/_next/static/")) return false;
  if (pathname.includes("?") || pathname.includes("#")) return false;
  if (pathname.includes("..") || pathname.includes("//")) return false;
  if (/[\x00-\x1F\x7F]/.test(pathname)) return false;
  return true;
}

export interface ValidateStaleAssetOptions {
  controllerBuildId?: string;
  controllerNonce?: string;
}

export function validateStaleAssetEnvelope(
  data: unknown,
  expected?: ValidateStaleAssetOptions
): StaleAssetEnvelope | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (!hasOnlyAllowedKeys(obj, STALE_ASSET_ALLOWED_KEYS)) return null;

  if (obj.protocol !== 1 || obj.type !== "K_STALE_ASSET" || obj.status !== 404) {
    return null;
  }

  if (typeof obj.requestNonce !== "string" || !obj.requestNonce.trim()) return null;
  if (typeof obj.buildId !== "string" || !obj.buildId.trim()) return null;
  if (typeof obj.workerNonce !== "string" || !obj.workerNonce.trim()) return null;
  if (typeof obj.pathname !== "string" || !isValidStaleAssetPath(obj.pathname)) return null;

  if (expected?.controllerBuildId && obj.buildId.trim() !== expected.controllerBuildId.trim()) {
    return null;
  }

  if (expected?.controllerNonce && obj.workerNonce.trim() !== expected.controllerNonce.trim()) {
    return null;
  }

  return {
    protocol: 1,
    type: "K_STALE_ASSET",
    requestNonce: obj.requestNonce.trim(),
    buildId: obj.buildId.trim(),
    workerNonce: obj.workerNonce.trim(),
    pathname: obj.pathname,
    status: 404,
  };
}

export async function requestServiceWorkerIdentity(
  worker: ServiceWorker,
  timeoutMs = 1500
): Promise<ServiceWorkerIdentity | null> {
  if (!worker || typeof worker.postMessage !== "function") return null;

  const requestNonce = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "";
  if (!requestNonce) return null;

  // Attempt 1: Try PWA_GET_IDENTITY (protocol v1) via MessageChannel
  try {
    const v1Result = await new Promise<ServiceWorkerIdentity | null>((resolve) => {
      let settled = false;
      const channel = new MessageChannel();

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          channel.port1.close();
          resolve(null);
        }
      }, timeoutMs);

      channel.port1.onmessage = (event) => {
        if (settled) return;
        if (isPwaIdentityResponse(event.data, requestNonce)) {
          settled = true;
          clearTimeout(timer);
          channel.port1.close();
          resolve({
            protocolVersion: 1,
            buildId: event.data.buildId,
            swVersion: event.data.swVersion,
            workerNonce: event.data.workerNonce,
          });
        }
      };

      worker.postMessage(
        {
          protocol: 1,
          type: "PWA_GET_IDENTITY",
          requestNonce,
        },
        [channel.port2]
      );
    });

    if (v1Result !== null) {
      return v1Result;
    }
  } catch {}

  // Attempt 2: Fallback to legacy GET_VERSION (protocol v0) via MessageChannel
  try {
    const v0Result = await new Promise<ServiceWorkerIdentity | null>((resolve) => {
      let settled = false;
      const channel = new MessageChannel();

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          channel.port1.close();
          resolve(null);
        }
      }, timeoutMs);

      channel.port1.onmessage = (event) => {
        if (settled) return;
        const data = event.data as Record<string, unknown> | null;
        if (data && (data.type === "VERSION_RESPONSE" || typeof data.version === "string")) {
          settled = true;
          clearTimeout(timer);
          channel.port1.close();
          const buildId = String(data.buildId || data.version || "");
          const swVersion = String(data.swVersion || data.version || "");
          if (buildId) {
            resolve({
              protocolVersion: 0,
              buildId,
              swVersion,
              workerNonce: null,
            });
            return;
          }
        }
      };

      worker.postMessage({ type: "GET_VERSION", requestNonce }, [channel.port2]);
    });

    return v0Result;
  } catch {
    return null;
  }
}
