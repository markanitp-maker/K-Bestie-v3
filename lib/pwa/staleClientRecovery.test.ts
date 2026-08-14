import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NEXT_STATIC_PREFIX,
  SHELL_CACHE_PREFIX,
  STALE_RECOVERY_GUARD_KEY,
  STALE_RECOVERY_MAX_ATTEMPTS,
  STALE_RECOVERY_MIN_INTERVAL_MS,
  STALE_RECOVERY_WINDOW_MS,
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
