import { BUILD_STAMP } from "./buildStamp";

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1시간 (3,600,000 ms)

export type VersionCheckStatus =
  | "no-update"
  | "mismatch"
  | "network-failure"
  | "invalid-response";

export interface ClientVersionMetadata {
  buildId: string;
  buildStamp: string;
  deploymentId: string;
  gitSha: string;
  swVersion: string;
  serverTime: number;
}

export interface VersionCheckResult {
  status: VersionCheckStatus;
  currentVersion: string;
  latestVersion: string | null;
  metadata?: ClientVersionMetadata | null;
  error?: string;
}

import {
  EXACT_SAFE_ROUTES,
  isSafeRoute,
  isExplicitRouteReady,
  isNavigationInFlight as isNavInFlightStore,
} from "./routeReadiness";

export { EXACT_SAFE_ROUTES, isSafeRoute };
export type SafeRoutePath = typeof EXACT_SAFE_ROUTES[number];

export interface RouteReadinessParams {
  pathname: string;
  checkedRevision?: string | number;
  currentRevision?: string | number;
  isReactReady?: boolean;
  isActivityReady?: boolean;
  isNavigationInFlight?: boolean;
}

/**
 * Safe means exact allowlist + current revision checked + explicit route ready token + activity store ready + navigation not in flight.
 */
export function isRouteReady(params: RouteReadinessParams): boolean {
  const {
    pathname,
    checkedRevision,
    currentRevision,
    isReactReady,
    isActivityReady,
    isNavigationInFlight,
  } = params;

  if (!isSafeRoute(pathname)) {
    return false;
  }

  if (
    checkedRevision !== undefined &&
    currentRevision !== undefined &&
    checkedRevision !== currentRevision
  ) {
    return false;
  }

  if (isReactReady === false || isActivityReady === false) {
    return false;
  }

  if (isNavigationInFlight === true || isNavInFlightStore()) {
    return false;
  }

  // Check explicit route readiness store in client environment
  if (typeof window !== "undefined") {
    const rev = typeof currentRevision === "number" ? currentRevision : undefined;
    if (!isExplicitRouteReady(pathname, rev)) {
      return false;
    }
  }

  return true;
}

export interface UpdateGateDecisionParams {
  hasUpdate: boolean;
  pathname: string;
  isConversationActive: boolean;
  hasActivityStatePublished?: boolean;
  checkedRevision?: string | number;
  currentRevision?: string | number;
  isReactReady?: boolean;
  isActivityReady?: boolean;
  isNavigationInFlight?: boolean;
}

/**
 * PWA Update Gate 모달 표시 여부를 결정하는 pure decision helper.
 */
export function evaluateUpdateGateDecision(params: UpdateGateDecisionParams): {
  shouldShowModal: boolean;
  isDeferred: boolean;
} {
  const {
    hasUpdate,
    pathname,
    isConversationActive,
    hasActivityStatePublished = false,
    checkedRevision,
    currentRevision,
    isReactReady = true,
    isActivityReady = true,
    isNavigationInFlight = false,
  } = params;

  if (!hasUpdate) {
    return { shouldShowModal: false, isDeferred: false };
  }

  if (isConversationActive) {
    return { shouldShowModal: false, isDeferred: true };
  }

  const routeReady = isRouteReady({
    pathname,
    checkedRevision,
    currentRevision,
    isReactReady,
    isActivityReady: hasActivityStatePublished || isActivityReady,
    isNavigationInFlight,
  });

  if (routeReady) {
    return { shouldShowModal: true, isDeferred: false };
  }

  return { shouldShowModal: false, isDeferred: true };
}

/**
 * 1시간 경과 판단 정책:
 * client load 시점 또는 last check 시점 기준으로 정확히 1시간(3,600,000ms) 이상 지난 경우 check 요구.
 */
export function shouldCheckForUpdate(params: {
  clientLoadedAt: number;
  lastCheckedAt: number | null;
  currentTime?: number;
  route?: string;
  isInitialCheck?: boolean;
}): boolean {
  const {
    clientLoadedAt,
    lastCheckedAt,
    currentTime = Date.now(),
    route = "/",
    isInitialCheck = false,
  } = params;

  if (isInitialCheck) {
    return isSafeRoute(route);
  }

  const baseTime = lastCheckedAt !== null ? lastCheckedAt : clientLoadedAt;
  const elapsed = currentTime - baseTime;

  if (elapsed >= UPDATE_CHECK_INTERVAL_MS) {
    return true;
  }

  return false;
}

export function evaluateVersionMismatch(
  currentVersion: string,
  latestVersion: string,
): "no-update" | "mismatch" {
  const current = currentVersion.trim();
  const latest = latestVersion.trim();
  if (current === latest) {
    return "no-update";
  }
  return "mismatch";
}

/**
 * no-update는 registration에 waiting worker와 installing worker가 모두 없을 때만 gate를 해제할 수 있다.
 */
export function canReleaseGateOnNoUpdate(registration?: {
  waiting?: unknown;
  installing?: unknown;
} | null): boolean {
  if (!registration) return true;
  if (registration.waiting || registration.installing) {
    return false;
  }
  return true;
}

/**
 * /api/client-version 메타데이터 파싱 및 버전을 평가한다.
 * no-update | mismatch | network-failure | invalid-response 4개 결과 분리 및 metadata 보존.
 */
export async function performClientVersionCheck(options: {
  currentVersion?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<VersionCheckResult> {
  const currentVersion = (options.currentVersion || BUILD_STAMP).trim();
  const fetchImpl = options.fetchImpl || fetch;

  try {
    const response = await fetchImpl("/api/client-version", {
      method: "GET",
      cache: "no-store",
      headers: {
        "x-k-bestie-client-build": currentVersion,
      },
    });

    if (!response.ok) {
      return {
        status: "network-failure",
        currentVersion,
        latestVersion: null,
        metadata: null,
        error: `HTTP_${response.status}`,
      };
    }

    const data = (await response.json().catch(() => null)) as Partial<ClientVersionMetadata> | null;

    if (
      !data ||
      typeof data.buildId !== "string" ||
      !data.buildId.trim() ||
      typeof data.buildStamp !== "string" ||
      !data.buildStamp.trim()
    ) {
      return {
        status: "invalid-response",
        currentVersion,
        latestVersion: null,
        metadata: null,
        error: "INVALID_RESPONSE",
      };
    }

    const validMetadata: ClientVersionMetadata = {
      buildId: data.buildId.trim(),
      buildStamp: data.buildStamp.trim(),
      deploymentId: typeof data.deploymentId === "string" ? data.deploymentId : "",
      gitSha: typeof data.gitSha === "string" ? data.gitSha : "",
      swVersion: typeof data.swVersion === "string" ? data.swVersion : "",
      serverTime: typeof data.serverTime === "number" ? data.serverTime : Date.now(),
    };

    const latestVersion = validMetadata.buildId;
    const evaluation = evaluateVersionMismatch(currentVersion, latestVersion);

    return {
      status: evaluation,
      currentVersion,
      latestVersion,
      metadata: validMetadata,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "NETWORK_ERROR";
    return {
      status: "network-failure",
      currentVersion,
      latestVersion: null,
      metadata: null,
      error: errorMessage,
    };
  }
}
