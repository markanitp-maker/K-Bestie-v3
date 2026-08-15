// 2026-08-14 Production 장애(김지호 계정, 20:08~20:55 KST) 근본원인 대응.
//
// 아이가 앱을 쓰는 47분 동안 프로덕션 배포가 3번 나갔다. 이미 로드된 클라이언트는
// 이전 배포의 청크 URL을 들고 있는데 그 URL이 사라지면서 동적 import가 실패했고,
// 자유대화는 "케이가 이야기를 준비하고 있어요..."에서, 미션은 "케이랑 접속이
// 끊겼네?"에서 영구히 멈췄다(turn_count 0, 미션 세션 미생성).
//
// 서비스워커가 /_next/static/을 캐시 우선으로 서빙하는데 캐시 이름이
// `kbestie-shell-<PWA_CLIENT_VERSION>` 하나로 고정돼 있어, 배포가 나가도 옛 청크가
// 그대로 남고 새 청크만 404가 났다. 그래서 아이가 앱을 껐다 켜도 복구되지 않는다.
//
// 여기서는 "청크를 못 받았다"는 신호를 잡아 shell 캐시를 통째로 비우고 한 번만
// 새로고침한다. 아이(사용자)가 업데이트 버튼을 누르지 않아도 스스로 복구되어야
// 한다는 것이 이 모듈의 존재 이유다.

import { requestStaleRecovery } from "./recoveryCoordinator";

export const SHELL_CACHE_PREFIX = "kbestie-shell-";
export const STALE_RECOVERY_GUARD_KEY = "k_stale_client_recovery";

/** Next.js 청크 경로 — 배포마다 갈리는 자산은 여기뿐이다. */
export const NEXT_STATIC_PREFIX = "/_next/static/";

// 실제 장애는 47분 동안 배포가 3번 나가면서 났다. "이 버전에서 한 번만 복구"로 막으면
// 두 번째 배포부터는 아이가 그대로 멈춘 채 남는다. 그래서 창(window) 안에서 횟수로
// 제한하되, 최소 간격을 둬서 새로고침이 연달아 돌지 않게 한다.
export const STALE_RECOVERY_MAX_ATTEMPTS = 3;
export const STALE_RECOVERY_MIN_INTERVAL_MS = 60_000;
export const STALE_RECOVERY_WINDOW_MS = 10 * 60_000;

/** 서비스워커가 정적 자산 404를 감지했을 때 클라이언트로 보내는 메시지 타입. */
export const STALE_ASSET_MESSAGE_TYPE = "K_STALE_ASSET";

// 번들러·브라우저마다 문구가 달라 name 하나로는 못 잡는다. 실제로 관측되는 표현을
// 모두 넣되, "network error"처럼 일시적 오프라인과 겹치는 표현은 넣지 않는다 —
// 오프라인일 때 새로고침을 돌리면 아이 화면만 더 깨진다.
const STALE_ASSET_SIGNATURES = [
  "chunkloaderror",
  "loading chunk",
  "loading css chunk",
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "unable to preload css",
];

function textOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Error) return `${input.name} ${input.message}`;
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const message = typeof record.message === "string" ? record.message : "";
    if (name || message) return `${name} ${message}`;
  }
  return "";
}

/**
 * 배포 교체로 클라이언트 자산을 못 받은 상황인지 판정한다.
 * ErrorEvent, PromiseRejectionEvent.reason, Error, 문자열을 모두 받는다.
 */
export function isStaleClientAssetError(input: unknown): boolean {
  const haystack = textOf(input).toLowerCase();
  if (!haystack.trim()) return false;
  return STALE_ASSET_SIGNATURES.some((signature) => haystack.includes(signature));
}

/**
 * shell 캐시 안의 `/_next/static/` 항목만 지운다.
 *
 * 캐시를 통째로 지우면 안 된다 — 같은 캐시에 `/offline`·아이콘·마스코트 같은
 * precache 자산이 함께 들어 있는데, 이들은 서비스워커 install 시점에만 채워진다.
 * 현재 워커를 그대로 둔 채 통째로 지우면 다시 채워지지 않고, 오프라인 진입 시
 * `caches.match("/offline")`가 undefined가 되어 안내 화면조차 못 띄운다.
 */
export async function purgeStaleChunkCache(cacheStorage: CacheStorage): Promise<number> {
  const names = (await cacheStorage.keys()).filter((name) => name.startsWith(SHELL_CACHE_PREFIX));
  let removed = 0;
  for (const name of names) {
    const cache = await cacheStorage.open(name);
    const requests = await cache.keys();
    const targets = requests.filter((request) => {
      try {
        return new URL(request.url).pathname.startsWith(NEXT_STATIC_PREFIX);
      } catch {
        return false;
      }
    });
    // 청크가 수백 개일 수 있다. 순차로 지우면 새로고침이 그만큼 늦어진다.
    const results = await Promise.allSettled(targets.map((request) => cache.delete(request)));
    removed += results.filter(
      (r): r is PromiseFulfilledResult<boolean> => r.status === "fulfilled" && Boolean(r.value)
    ).length;
  }
  return removed;
}

export const FORCED_UPDATE_GUARD_KEY = "k_forced_update_reload";
export const FORCED_UPDATE_MIN_INTERVAL_MS = 10_000;

export type ForcedUpdateResult = "reloading" | "no_update" | "too_soon" | "unsupported";

type ForcedUpdateOptions = {
  clientBuildId: string;
  fetchImpl?: typeof fetch;
  cacheStorage?: CacheStorage | null;
  sessionStorageImpl?: Pick<Storage, "getItem" | "setItem">;
  reload?: () => void;
  now?: () => number;
  versionCheckTimeoutMs?: number;
  /** 대기 중인 서비스워커를 찾아 즉시 적용시킨다. 없으면 false. */
  activateWaitingWorker?: () => Promise<boolean>;
};

export const FORCED_UPDATE_VERSION_CHECK_TIMEOUT_MS = 2_000;

async function defaultActivateWaitingWorker(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  await registration.update().catch(() => {});
  const waiting = registration.waiting;
  if (!waiting) return false;
  waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

/**
 * 아이가 「다시 시도」를 눌렀을 때 실제로 최신 버전으로 갈아타고 다시 연다.
 *
 * 기존 「다시 시도」는 화면 안에서 턴만 다시 보내는 동작이라, 앱이 옛 버전에
 * 물려 있으면 몇 번을 눌러도 같은 자리에서 막힌다(2026-08-14 장애). 새 버전이
 * 있으면 청크 캐시를 비우고 대기 중인 서비스워커를 적용한 뒤 새로고침한다.
 * 미션 진행 상태는 서버에 있으므로 처음부터가 아니라 하던 지점에서 이어진다.
 */
export async function forceUpdateAndReload({
  clientBuildId,
  fetchImpl = fetch,
  cacheStorage = typeof caches === "undefined" ? null : caches,
  sessionStorageImpl = typeof window === "undefined" ? undefined : window.sessionStorage,
  reload = () => window.location.reload(),
  now = () => Date.now(),
  versionCheckTimeoutMs = FORCED_UPDATE_VERSION_CHECK_TIMEOUT_MS,
  activateWaitingWorker = defaultActivateWaitingWorker,
}: ForcedUpdateOptions): Promise<ForcedUpdateResult> {
  if (!sessionStorageImpl) return "unsupported";

  const at = now();
  let previousGuard = "";
  try {
    previousGuard = sessionStorageImpl.getItem(FORCED_UPDATE_GUARD_KEY) || "";
    const lastAt = Number(previousGuard || 0);
    if (lastAt > 0 && at - lastAt < FORCED_UPDATE_MIN_INTERVAL_MS) return "too_soon";
    sessionStorageImpl.setItem(FORCED_UPDATE_GUARD_KEY, String(at));
  } catch {
    return "unsupported";
  }

  const restoreGuard = () => {
    try {
      sessionStorageImpl.setItem(FORCED_UPDATE_GUARD_KEY, previousGuard);
    } catch {}
  };

  let serverBuildId: string | null = null;
  try {
    const response = await fetchImpl("/api/client-version", {
      cache: "no-store",
      headers: { "Cache-Control": "no-store" },
      signal: AbortSignal.timeout(versionCheckTimeoutMs),
    });
    if (response.ok) {
      const body = (await response.json()) as { buildId?: unknown };
      if (typeof body.buildId === "string" && body.buildId.trim()) serverBuildId = body.buildId.trim();
    }
  } catch {}

  const hasWaitingWorker = await activateWaitingWorker().catch(() => false);
  const versionMismatch = serverBuildId !== null && serverBuildId !== clientBuildId;
  if (!hasWaitingWorker && !versionMismatch) {
    restoreGuard();
    return "no_update";
  }

  // Notify recovery coordinator
  requestStaleRecovery({
    source: "manual",
    buildId: serverBuildId || undefined,
    timestamp: at,
  });

  if (cacheStorage) {
    try {
      await purgeStaleChunkCache(cacheStorage);
    } catch {}
  }

  if (serverBuildId) {
    try {
      sessionStorageImpl.setItem(`pwa_sw_reloaded_${serverBuildId}`, "true");
    } catch {}
  }

  reload();
  return "reloading";
}

export type StaleClientRecoveryResult =
  | "reloading"
  | "too_soon"
  | "exhausted"
  | "offline"
  | "unsupported";

export type StaleRecoveryGuard = { count: number; lastAt: number };

/** sessionStorage에 담긴 복구 시도 기록을 읽는다. 손상된 값은 기록 없음으로 본다. */
export function readRecoveryGuard(raw: string | null, now: number): StaleRecoveryGuard {
  if (!raw) return { count: 0, lastAt: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<StaleRecoveryGuard>;
    const count = typeof parsed.count === "number" && parsed.count >= 0 ? parsed.count : 0;
    const lastAt = typeof parsed.lastAt === "number" && parsed.lastAt >= 0 ? parsed.lastAt : 0;
    if (now - lastAt > STALE_RECOVERY_WINDOW_MS) return { count: 0, lastAt: 0 };
    return { count, lastAt };
  } catch {
    return { count: 0, lastAt: 0 };
  }
}

type RecoverStaleClientOptions = {
  cacheStorage?: CacheStorage | null;
  sessionStorageImpl?: Pick<Storage, "getItem" | "setItem">;
  reload?: () => void;
  isOnline?: () => boolean;
  now?: () => number;
};

/**
 * 배포마다 갈리는 청크 캐시를 비우고 새로고침한다.
 *
 * 10분 창 안에서 최대 3회, 최소 60초 간격.
 */
export async function recoverStaleClient({
  cacheStorage = typeof caches === "undefined" ? null : caches,
  sessionStorageImpl = typeof window === "undefined" ? undefined : window.sessionStorage,
  reload = () => window.location.reload(),
  isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine),
  now = () => Date.now(),
}: RecoverStaleClientOptions = {}): Promise<StaleClientRecoveryResult> {
  if (!sessionStorageImpl) return "unsupported";

  if (!isOnline()) return "offline";

  const at = now();
  let guard: StaleRecoveryGuard;
  try {
    guard = readRecoveryGuard(sessionStorageImpl.getItem(STALE_RECOVERY_GUARD_KEY), at);
    if (guard.count >= STALE_RECOVERY_MAX_ATTEMPTS) {
      sessionStorageImpl.setItem(
        STALE_RECOVERY_GUARD_KEY,
        JSON.stringify({ count: guard.count, lastAt: at } satisfies StaleRecoveryGuard)
      );
      return "exhausted";
    }
    if (guard.lastAt > 0 && at - guard.lastAt < STALE_RECOVERY_MIN_INTERVAL_MS) return "too_soon";
    sessionStorageImpl.setItem(
      STALE_RECOVERY_GUARD_KEY,
      JSON.stringify({ count: guard.count + 1, lastAt: at } satisfies StaleRecoveryGuard)
    );
  } catch {
    return "unsupported";
  }

  requestStaleRecovery({
    source: "manual",
    timestamp: at,
  });

  if (cacheStorage) {
    try {
      await purgeStaleChunkCache(cacheStorage);
    } catch {}
  }

  reload();
  return "reloading";
}
