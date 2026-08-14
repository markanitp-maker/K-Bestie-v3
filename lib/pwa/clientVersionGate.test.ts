import assert from "node:assert/strict";
import test from "node:test";

import {
  compareMissionBuildIds,
  ensureMissionClientVersion,
} from "./clientVersionGate.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("동일 build는 Mission 진입을 허용한다", async () => {
  const result = await ensureMissionClientVersion({
    clientBuildId: "sha-1",
    fetchImpl: (async () => Response.json({ buildId: "sha-1" })) as typeof fetch,
    sessionStorageImpl: memoryStorage(),
    reload: () => assert.fail("reload must not run"),
    requestServiceWorkerUpdate: async () => assert.fail("update must not run"),
  });
  assert.deepEqual(result, { status: "ready", serverBuildId: "sha-1" });
});

test("build 불일치는 service worker 확인 뒤 한 번만 reload한다", async () => {
  const storage = memoryStorage();
  let reloads = 0;
  let updates = 0;
  const options = {
    clientBuildId: "old",
    fetchImpl: (async () => Response.json({ buildId: "new" })) as typeof fetch,
    sessionStorageImpl: storage,
    reload: () => { reloads += 1; },
    requestServiceWorkerUpdate: async () => { updates += 1; },
  };

  assert.deepEqual(await ensureMissionClientVersion(options), {
    status: "reload_started",
    serverBuildId: "new",
  });
  assert.deepEqual(await ensureMissionClientVersion(options), {
    status: "update_required",
    serverBuildId: "new",
  });
  assert.equal(reloads, 1);
  assert.equal(updates, 1);
});

test("version endpoint 실패는 Mission 진입을 허용하지 않는다", async () => {
  const result = await ensureMissionClientVersion({
    clientBuildId: "sha-1",
    fetchImpl: (async () => new Response(null, { status: 503 })) as typeof fetch,
    sessionStorageImpl: memoryStorage(),
  });
  assert.equal(result.status, "unavailable");
});

test("placeholder build ID도 불일치면 reload 대상으로 판정한다", () => {
  assert.equal(compareMissionBuildIds("local", "sha-1"), "mismatch");
  assert.equal(compareMissionBuildIds("sha-1", "local"), "mismatch");
});
