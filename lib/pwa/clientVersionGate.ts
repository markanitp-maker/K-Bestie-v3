import { PWA_CLIENT_VERSION } from "./clientVersion";
import { purgeStaleChunkCache } from "./staleClientRecovery";

export type MissionClientVersionGateResult =
  | { status: "ready"; serverBuildId: string }
  | { status: "reload_started"; serverBuildId: string }
  | { status: "update_required"; serverBuildId: string }
  | { status: "unavailable"; serverBuildId: null };

type ClientVersionResponse = {
  buildId?: unknown;
};

type VersionGateOptions = {
  clientBuildId?: string;
  fetchImpl?: typeof fetch;
  sessionStorageImpl?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  reload?: () => void;
  requestServiceWorkerUpdate?: () => Promise<void>;
  cacheStorage?: CacheStorage | null;
};

const RELOAD_GUARD_PREFIX = "k_mission_version_reload:";

export function compareMissionBuildIds(
  clientBuildId: string,
  serverBuildId: string,
): "ready" | "mismatch" {
  return clientBuildId === serverBuildId ? "ready" : "mismatch";
}

async function defaultServiceWorkerUpdate(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  await registration?.update();
}

export async function ensureMissionClientVersion({
  clientBuildId = PWA_CLIENT_VERSION,
  fetchImpl = fetch,
  sessionStorageImpl = window.sessionStorage,
  reload = () => window.location.reload(),
  requestServiceWorkerUpdate = defaultServiceWorkerUpdate,
  cacheStorage = typeof caches === "undefined" ? null : caches,
}: VersionGateOptions = {}): Promise<MissionClientVersionGateResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/client-version", {
      method: "GET",
      cache: "no-store",
      headers: { "x-k-bestie-client-build": clientBuildId },
    });
  } catch (error) {
    console.error("[Mission] client version check failed", error);
    return { status: "unavailable", serverBuildId: null };
  }

  if (!response.ok) {
    console.error("[Mission] client version endpoint failed", { status: response.status });
    return { status: "unavailable", serverBuildId: null };
  }

  const body = await response.json().catch(() => null) as ClientVersionResponse | null;
  if (!body || typeof body.buildId !== "string" || body.buildId.trim() === "") {
    console.error("[Mission] client version response is invalid");
    return { status: "unavailable", serverBuildId: null };
  }

  const serverBuildId = body.buildId.trim();
  const guardKey = `${RELOAD_GUARD_PREFIX}${clientBuildId}:${serverBuildId}`;
  if (compareMissionBuildIds(clientBuildId, serverBuildId) === "ready") {
    sessionStorageImpl.removeItem(guardKey);
    return { status: "ready", serverBuildId };
  }

  if (sessionStorageImpl.getItem(guardKey) === "true") {
    console.error("[Mission] client version mismatch remained after reload", {
      clientBuildId,
      serverBuildId,
    });
    return { status: "update_required", serverBuildId };
  }

  sessionStorageImpl.setItem(guardKey, "true");
  try {
    void requestServiceWorkerUpdate().catch((error: unknown) => {
      console.warn("[Mission] service worker update check failed before reload", error);
    });
  } catch (error) {
    console.warn("[Mission] service worker update check failed before reload", error);
  }

  // 2026-08-14 Production 장애: 새로고침만 하면 서비스워커가 캐시 우선으로 같은 옛
  // 번들을 다시 내주기 때문에 두 번째 시도에서도 mismatch가 나고 아이는 update_required
  // 안내에 갇힌다. 청크 캐시를 비운 뒤 새로고침해야 실제로 새 버전이 올라온다
  // (오프라인 안내 화면용 precache 자산은 남긴다).
  if (cacheStorage) {
    try {
      await purgeStaleChunkCache(cacheStorage);
    } catch (error) {
      console.warn("[Mission] stale chunk cache purge failed before reload", error);
    }
  }

  reload();
  return { status: "reload_started", serverBuildId };
}
