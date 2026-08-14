import assert from "node:assert/strict";
import test from "node:test";

import {
  compareMissionBuildIds,
  ensureMissionClientVersion,
} from "./clientVersionGate";
import {
  subscribeStaleRecovery,
  resetRecoveryCoordinatorForTest,
  StaleRecoverySignal,
} from "./recoveryCoordinator";

test("동일 build는 Mission 진입을 허용한다", async () => {
  resetRecoveryCoordinatorForTest();
  let signaled = false;
  const unsubscribe = subscribeStaleRecovery(() => {
    signaled = true;
  });

  const result = await ensureMissionClientVersion({
    clientBuildId: "sha-1",
    fetchImpl: (async () => Response.json({ buildId: "sha-1" })) as typeof fetch,
    requestServiceWorkerUpdate: async () => assert.fail("update must not run"),
  });
  assert.deepEqual(result, { status: "ready", serverBuildId: "sha-1" });
  assert.equal(signaled, false, "Ready version emits 0 recovery signals");

  unsubscribe();
  resetRecoveryCoordinatorForTest();
});

test("build 불일치는 coordinator에 signal만 전달하고 direct reload/cache purge 없이 update_required를 반환한다", async () => {
  resetRecoveryCoordinatorForTest();
  const signals: StaleRecoverySignal[] = [];
  const unsubscribe = subscribeStaleRecovery((sig) => {
    signals.push(sig);
  });

  let updates = 0;
  const options = {
    clientBuildId: "old",
    fetchImpl: (async () => Response.json({ buildId: "new" })) as typeof fetch,
    requestServiceWorkerUpdate: async () => {
      updates += 1;
    },
  };

  const result = await ensureMissionClientVersion(options);
  assert.deepEqual(result, {
    status: "update_required",
    serverBuildId: "new",
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].source, "mission_gate");
  assert.equal(signals[0].buildId, "new");
  assert.equal(updates, 1);

  unsubscribe();
  resetRecoveryCoordinatorForTest();
});

test("version endpoint 실패는 Mission 진입을 허용하지 않는다", async () => {
  resetRecoveryCoordinatorForTest();
  const result = await ensureMissionClientVersion({
    clientBuildId: "sha-1",
    fetchImpl: (async () => new Response(null, { status: 503 })) as typeof fetch,
  });
  assert.equal(result.status, "unavailable");
  resetRecoveryCoordinatorForTest();
});

test("placeholder build ID도 불일치면 reload/mismatch 대상으로 판정한다", () => {
  assert.equal(compareMissionBuildIds("local", "sha-1"), "mismatch");
  assert.equal(compareMissionBuildIds("sha-1", "local"), "mismatch");
});
