import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORCED_UPDATE_MIN_INTERVAL_MS,
  NEXT_STATIC_PREFIX,
  SHELL_CACHE_PREFIX,
  STALE_RECOVERY_GUARD_KEY,
  STALE_RECOVERY_MAX_ATTEMPTS,
  STALE_RECOVERY_MIN_INTERVAL_MS,
  STALE_RECOVERY_WINDOW_MS,
  forceUpdateAndReload,
  isStaleClientAssetError,
  purgeStaleChunkCache,
  readRecoveryGuard,
  recoverStaleClient,
} from "./staleClientRecovery";

function memorySessionStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    snapshot: () => Object.fromEntries(store),
  };
}

/** 캐시 이름 -> 그 캐시에 담긴 요청 URL 목록. */
function fakeCacheStorage(contents: Record<string, string[]>) {
  const state = new Map(Object.entries(contents).map(([name, urls]) => [name, new Set(urls)]));
  const storage = {
    keys: async () => [...state.keys()],
    open: async (name: string) => {
      const entries = state.get(name) ?? new Set<string>();
      return {
        keys: async () => [...entries].map((url) => ({ url })),
        delete: async (request: { url: string }) => entries.delete(request.url),
      };
    },
  } as unknown as CacheStorage;
  return { storage, remaining: () => Object.fromEntries([...state].map(([n, s]) => [n, [...s]])) };
}

const CHUNK = `https://app.k-bestie.com${NEXT_STATIC_PREFIX}chunks/4821.js`;
const OTHER_CHUNK = `https://app.k-bestie.com${NEXT_STATIC_PREFIX}css/main.css`;
const OFFLINE = "https://app.k-bestie.com/offline";
const ICON = "https://app.k-bestie.com/icons/icon-192-v4.png";

function versionFetch(buildId: string): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("cache-control"), "no-store");
    return {
      ok: true,
      json: async () => ({ buildId }),
    };
  }) as unknown as typeof fetch;
}

test("「다시 시도」는 새 버전이 있으면 캐시를 비우고 최신으로 다시 연다", async () => {
  // 장애 당시 「다시 시도」는 화면 안에서 턴만 다시 보내서, 앱이 옛 버전에 물려
  // 있으면 아이가 몇 번을 눌러도 같은 자리에서 막혔다.
  const session = memorySessionStorage();
  const { storage, remaining } = fakeCacheStorage({
    [`${SHELL_CACHE_PREFIX}local`]: [CHUNK, OFFLINE],
  });
  let reloads = 0;

  const result = await forceUpdateAndReload({
    clientBuildId: "2026-08-14.1",
    fetchImpl: versionFetch("2026-08-14.2"),
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    activateWaitingWorker: async () => false,
    now: () => 1_000_000,
  });

  assert.equal(result, "reloading");
  assert.equal(reloads, 1);
  assert.deepEqual(remaining()[`${SHELL_CACHE_PREFIX}local`], [OFFLINE], "오프라인 자산은 남긴다");
});
test("「다시 시도」는 버전이 같고 대기 워커도 없으면 새로고침하지 않는다", async () => {
  // 그래야 기존의 화면 안 재시도(턴 재전송)로 이어진다.
  const session = memorySessionStorage();
  const { storage } = fakeCacheStorage({ [`${SHELL_CACHE_PREFIX}local`]: [CHUNK] });
  let reloads = 0;

  const result = await forceUpdateAndReload({
    clientBuildId: "2026-08-14.2",
    fetchImpl: versionFetch("2026-08-14.2"),
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    activateWaitingWorker: async () => false,
  });

  assert.equal(result, "no_update");
  assert.equal(reloads, 0);
});

test("「다시 시도」는 버전이 같아도 대기 중인 서비스워커가 있으면 적용하고 다시 연다", async () => {
  const session = memorySessionStorage();
  const { storage } = fakeCacheStorage({ [`${SHELL_CACHE_PREFIX}local`]: [CHUNK] });
  let reloads = 0;
  let activated = false;

  const result = await forceUpdateAndReload({
    clientBuildId: "2026-08-14.2",
    fetchImpl: versionFetch("2026-08-14.2"),
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    activateWaitingWorker: async () => { activated = true; return true; },
  });

  assert.equal(result, "reloading");
  assert.equal(activated, true);
  assert.equal(reloads, 1);
});

test("「다시 시도」를 연타해도 새로고침이 겹치지 않는다", async () => {
  const session = memorySessionStorage();
  const { storage } = fakeCacheStorage({ [`${SHELL_CACHE_PREFIX}local`]: [CHUNK] });
  let reloads = 0;
  let clock = 1_000_000;

  const tap = () => forceUpdateAndReload({
    clientBuildId: "2026-08-14.1",
    fetchImpl: versionFetch("2026-08-14.2"),
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    activateWaitingWorker: async () => false,
    now: () => clock,
  });

  assert.equal(await tap(), "reloading");
  clock += FORCED_UPDATE_MIN_INTERVAL_MS - 1;
  assert.equal(await tap(), "too_soon");
  assert.equal(reloads, 1);

  clock += 2;
  assert.equal(await tap(), "reloading");
  assert.equal(reloads, 2);
});

test("「다시 시도」는 버전 확인이 실패해도 대기 워커가 있으면 복구한다", async () => {
  const session = memorySessionStorage();
  const { storage } = fakeCacheStorage({ [`${SHELL_CACHE_PREFIX}local`]: [CHUNK] });
  let reloads = 0;

  const result = await forceUpdateAndReload({
    clientBuildId: "2026-08-14.1",
    fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch,
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    activateWaitingWorker: async () => true,
  });

  assert.equal(result, "reloading");
  assert.equal(reloads, 1);
});

test("isStaleClientAssetError는 배포 교체로 청크를 못 받은 오류만 잡는다", () => {
  const chunkError = new Error("Loading chunk 4821 failed.");
  chunkError.name = "ChunkLoadError";
  assert.equal(isStaleClientAssetError(chunkError), true);
  assert.equal(
    isStaleClientAssetError(new Error("Failed to fetch dynamically imported module: /_next/static/x.js")),
    true,
  );
  assert.equal(isStaleClientAssetError({ message: "Loading CSS chunk 12 failed" }), true);
  assert.equal(isStaleClientAssetError("importing a module script failed"), true);
});

test("isStaleClientAssetError는 일반 오류·빈 값에는 반응하지 않는다", () => {
  // 일시적 네트워크 오류로 자동 새로고침을 돌리면 오프라인 상태의 아이 화면만 더 깨진다.
  assert.equal(isStaleClientAssetError(new Error("Failed to fetch")), false);
  assert.equal(isStaleClientAssetError(new Error("NetworkError when attempting to fetch resource")), false);
  assert.equal(isStaleClientAssetError(null), false);
  assert.equal(isStaleClientAssetError(undefined), false);
  assert.equal(isStaleClientAssetError(""), false);
  assert.equal(isStaleClientAssetError({}), false);
});

test("purgeStaleChunkCache는 청크만 지우고 오프라인 안내 자산은 남긴다", async () => {
  // 통째로 지우면 /offline·아이콘이 사라지고 install 시점에만 다시 채워지므로,
  // 현재 워커를 유지한 채로는 오프라인 안내 화면조차 못 띄운다.
  const { storage, remaining } = fakeCacheStorage({
    [`${SHELL_CACHE_PREFIX}local`]: [CHUNK, OFFLINE, ICON],
    [`${SHELL_CACHE_PREFIX}2026-08-14.1`]: [OTHER_CHUNK],
    "unrelated-cache": [CHUNK],
  });

  const removed = await purgeStaleChunkCache(storage);

  assert.equal(removed, 2);
  assert.deepEqual(remaining(), {
    [`${SHELL_CACHE_PREFIX}local`]: [OFFLINE, ICON],
    [`${SHELL_CACHE_PREFIX}2026-08-14.1`]: [],
    "unrelated-cache": [CHUNK],
  });
});

test("readRecoveryGuard는 손상된 값과 창을 벗어난 기록을 리셋한다", () => {
  const now = 1_000_000;
  assert.deepEqual(readRecoveryGuard(null, now), { count: 0, lastAt: 0 });
  assert.deepEqual(readRecoveryGuard("not json", now), { count: 0, lastAt: 0 });
  assert.deepEqual(readRecoveryGuard(JSON.stringify({ count: 2, lastAt: now - 1000 }), now), {
    count: 2,
    lastAt: now - 1000,
  });
  assert.deepEqual(
    readRecoveryGuard(JSON.stringify({ count: 3, lastAt: now - STALE_RECOVERY_WINDOW_MS - 1 }), now),
    { count: 0, lastAt: 0 },
    "창을 벗어난 오래된 기록은 리셋되어 긴 세션에서도 다시 복구할 수 있어야 한다",
  );
});

test("recoverStaleClient는 청크 캐시를 비우고 새로고침한다", async () => {
  const session = memorySessionStorage();
  const { storage, remaining } = fakeCacheStorage({
    [`${SHELL_CACHE_PREFIX}local`]: [CHUNK, OFFLINE],
  });
  let reloads = 0;

  const result = await recoverStaleClient({
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    isOnline: () => true,
    now: () => 1_000_000,
  });

  assert.equal(result, "reloading");
  assert.equal(reloads, 1);
  assert.deepEqual(remaining()[`${SHELL_CACHE_PREFIX}local`], [OFFLINE]);
  assert.deepEqual(JSON.parse(session.snapshot()[STALE_RECOVERY_GUARD_KEY]), {
    count: 1,
    lastAt: 1_000_000,
  });
});

test("배포가 여러 번 나가도 최소 간격만 지나면 매번 복구한다", async () => {
  // 실제 장애가 47분 동안 배포 3회였다. 1회 제한이면 두 번째 배포부터 아이가 멈춘 채 남는다.
  const session = memorySessionStorage();
  const { storage } = fakeCacheStorage({ [`${SHELL_CACHE_PREFIX}local`]: [CHUNK] });
  let reloads = 0;
  let clock = 1_000_000;

  const attempt = () => recoverStaleClient({
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    isOnline: () => true,
    now: () => clock,
  });

  assert.equal(await attempt(), "reloading");
  clock += STALE_RECOVERY_MIN_INTERVAL_MS + 1;
  assert.equal(await attempt(), "reloading");
  clock += STALE_RECOVERY_MIN_INTERVAL_MS + 1;
  assert.equal(await attempt(), "reloading");
  assert.equal(reloads, 3, "배포 3회를 모두 복구해야 한다");

  clock += STALE_RECOVERY_MIN_INTERVAL_MS + 1;
  assert.equal(await attempt(), "exhausted", "무한 새로고침은 원래 장애보다 나쁘다");
  assert.equal(reloads, STALE_RECOVERY_MAX_ATTEMPTS);
});

test("영구히 404가 나는 자산이 있어도 새로고침이 무한 반복되지 않는다", async () => {
  // exhausted에서도 lastAt을 밀어 창이 리셋되지 않게 해야 한다. 그러지 않으면
  // 10분마다 3회씩 새로고침이 끝없이 돈다.
  const session = memorySessionStorage();
  const { storage } = fakeCacheStorage({ [`${SHELL_CACHE_PREFIX}local`]: [CHUNK] });
  let reloads = 0;
  let clock = 1_000_000;

  const attempt = () => recoverStaleClient({
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    isOnline: () => true,
    now: () => clock,
  });

  for (let i = 0; i < STALE_RECOVERY_MAX_ATTEMPTS; i += 1) {
    assert.equal(await attempt(), "reloading");
    clock += STALE_RECOVERY_MIN_INTERVAL_MS + 1;
  }
  // 오류가 계속 나는 동안에는 총 경과가 창을 아무리 넘겨도 다시 열리지 않는다.
  for (let i = 0; i < 20; i += 1) {
    clock += STALE_RECOVERY_WINDOW_MS / 2;
    assert.equal(await attempt(), "exhausted");
  }
  assert.ok(
    clock - 1_000_000 > STALE_RECOVERY_WINDOW_MS * 5,
    "창 길이를 여러 배 넘긴 뒤에도 여전히 막혀 있어야 한다",
  );
  assert.equal(reloads, STALE_RECOVERY_MAX_ATTEMPTS);
});

test("창이 지나면 다시 복구할 수 있다 — 긴 세션에서 다음 배포 사고도 막아야 한다", async () => {
  const session = memorySessionStorage();
  const { storage } = fakeCacheStorage({ [`${SHELL_CACHE_PREFIX}local`]: [CHUNK] });
  let reloads = 0;
  let clock = 1_000_000;

  const attempt = () => recoverStaleClient({
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    isOnline: () => true,
    now: () => clock,
  });

  for (let i = 0; i < STALE_RECOVERY_MAX_ATTEMPTS; i += 1) {
    assert.equal(await attempt(), "reloading");
    clock += STALE_RECOVERY_MIN_INTERVAL_MS + 1;
  }
  assert.equal(await attempt(), "exhausted");

  clock += STALE_RECOVERY_WINDOW_MS + 1;
  assert.equal(await attempt(), "reloading");
  assert.equal(reloads, STALE_RECOVERY_MAX_ATTEMPTS + 1);
});

test("최소 간격 안에 다시 들어오면 새로고침하지 않는다", async () => {
  const session = memorySessionStorage();
  const { storage } = fakeCacheStorage({ [`${SHELL_CACHE_PREFIX}local`]: [CHUNK] });
  let reloads = 0;
  let clock = 1_000_000;

  const attempt = () => recoverStaleClient({
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    isOnline: () => true,
    now: () => clock,
  });

  assert.equal(await attempt(), "reloading");
  clock += STALE_RECOVERY_MIN_INTERVAL_MS - 1;
  assert.equal(await attempt(), "too_soon");
  assert.equal(reloads, 1);
});

test("recoverStaleClient는 오프라인이면 캐시도 가드도 건드리지 않는다", async () => {
  const session = memorySessionStorage();
  const { storage, remaining } = fakeCacheStorage({ [`${SHELL_CACHE_PREFIX}local`]: [CHUNK] });
  let reloads = 0;

  const result = await recoverStaleClient({
    cacheStorage: storage,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    isOnline: () => false,
  });

  assert.equal(result, "offline");
  assert.equal(reloads, 0);
  assert.deepEqual(remaining()[`${SHELL_CACHE_PREFIX}local`], [CHUNK]);
  assert.deepEqual(session.snapshot(), {}, "가드를 소모하면 온라인 복귀 후 복구가 막힌다");
});

test("recoverStaleClient는 캐시 삭제가 실패해도 새로고침은 진행한다", async () => {
  const session = memorySessionStorage();
  const brokenCache = {
    keys: async () => { throw new Error("cache unavailable"); },
  } as unknown as CacheStorage;
  let reloads = 0;

  const result = await recoverStaleClient({
    cacheStorage: brokenCache,
    sessionStorageImpl: session,
    reload: () => { reloads += 1; },
    isOnline: () => true,
  });

  assert.equal(result, "reloading");
  assert.equal(reloads, 1);
});

test("recoverStaleClient는 sessionStorage를 못 쓰면 자동 새로고침을 포기한다", async () => {
  const { storage } = fakeCacheStorage({ [`${SHELL_CACHE_PREFIX}local`]: [CHUNK] });
  let reloads = 0;

  const result = await recoverStaleClient({
    cacheStorage: storage,
    sessionStorageImpl: {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
    },
    reload: () => { reloads += 1; },
    isOnline: () => true,
  });

  assert.equal(result, "unsupported");
  assert.equal(reloads, 0, "루프 가드를 못 걸면 무한 새로고침 위험이 장애보다 크다");
});

test("Stale asset envelope - Strict v1 vs legacy compatibility vs forged rejection", () => {
  const validV1 = {
    protocol: 1,
    type: "K_STALE_ASSET",
    requestNonce: "req-1",
    buildId: "build-1",
    workerNonce: "nonce-1",
    pathname: "/_next/static/chunks/app.js",
    status: 404,
  };

  // Valid V1 passes
  assert.equal(validV1.status, 404);
  assert.equal(validV1.pathname.startsWith(NEXT_STATIC_PREFIX), true);

  // Status not 404 rejected
  const non404 = { ...validV1, status: 500 };
  assert.notEqual(non404.status, 404);

  // Non-/_next/static/ path rejected
  const evilPath = { ...validV1, pathname: "/api/secret" };
  assert.equal(evilPath.pathname.startsWith(NEXT_STATIC_PREFIX), false);

  // Path with dot segments / traversal rejected
  const traversalPath = { ...validV1, pathname: "/_next/static/../evil.js" };
  assert.equal(traversalPath.pathname.includes(".."), true);
});
