import test from "node:test";
import assert from "node:assert/strict";
import {
  subscribeStaleRecovery,
  requestStaleRecovery,
  resetRecoveryCoordinatorForTest,
  saveExternalControllerPending,
  getExternalControllerPending,
  clearExternalControllerPending,
  parseExternalControllerPending,
  ExternalControllerPendingV1,
  StaleRecoverySignal,
  EXTERNAL_CONTROLLER_PENDING_KEY,
} from "./recoveryCoordinator";

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    snapshot: () => Object.fromEntries(store),
  };
}

test("recoveryCoordinator - Dispatches stale recovery signal to subscribers", () => {
  resetRecoveryCoordinatorForTest();

  const received: StaleRecoverySignal[] = [];
  const unsubscribe = subscribeStaleRecovery((signal) => {
    received.push(signal);
  });

  const signal: StaleRecoverySignal = {
    source: "chunk_error",
    pathname: "/_next/static/chunks/123.js",
    buildId: "build-v1",
    workerNonce: "nonce-w1",
    timestamp: 123456,
  };

  requestStaleRecovery(signal);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], signal);

  unsubscribe();
  requestStaleRecovery(signal);
  assert.equal(received.length, 1, "Unsubscribed listener receives no further signals");

  resetRecoveryCoordinatorForTest();
});

test("recoveryCoordinator - ExternalControllerPendingV1 schema validation, save, get, clear", () => {
  resetRecoveryCoordinatorForTest();
  const storage = memoryStorage();

  const validPending: ExternalControllerPendingV1 = {
    schemaVersion: 1,
    observedAt: 1700000000,
    controllerBuildId: "build-target-1",
    controllerSwVersion: "sw-v2",
    controllerScriptUrl: "/sw.js",
  };

  // 1. Parsing valid object
  assert.deepEqual(parseExternalControllerPending(validPending), validPending);

  // 2. Parsing valid JSON string
  assert.deepEqual(parseExternalControllerPending(JSON.stringify(validPending)), validPending);

  // 3. Rejecting invalid schemas
  assert.equal(parseExternalControllerPending(null), null);
  assert.equal(parseExternalControllerPending({ schemaVersion: 2 }), null);
  assert.equal(parseExternalControllerPending({ schemaVersion: 1, observedAt: -5 }), null);
  assert.equal(parseExternalControllerPending("not json"), null);

  // 4. Save and Get
  assert.equal(saveExternalControllerPending(validPending, storage), true);
  assert.deepEqual(getExternalControllerPending(storage), validPending);
  assert.ok(storage.snapshot()[EXTERNAL_CONTROLLER_PENDING_KEY]);

  // 5. Clear
  clearExternalControllerPending(storage);
  assert.equal(getExternalControllerPending(storage), null);
  assert.equal(storage.snapshot()[EXTERNAL_CONTROLLER_PENDING_KEY], undefined);

  resetRecoveryCoordinatorForTest();
});

test("recoveryCoordinator - ExternalControllerPendingV1 unverified identity fallback", () => {
  resetRecoveryCoordinatorForTest();
  const storage = memoryStorage();

  const unverifiedPending: ExternalControllerPendingV1 = {
    schemaVersion: 1,
    observedAt: 1700000000,
    controllerBuildId: null,
    controllerSwVersion: null,
    controllerScriptUrl: null,
  };

  assert.equal(saveExternalControllerPending(unverifiedPending, storage), true);
  assert.deepEqual(getExternalControllerPending(storage), unverifiedPending);

  resetRecoveryCoordinatorForTest();
});
