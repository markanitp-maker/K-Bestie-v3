import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PWA_ACTIVATION_DELAY_MS,
  PWA_DISMISS_COOLDOWN_MS,
  OneShotActivationTracker,
  clearReloadPendingMarker,
  createOneShotActivationTracker,
  decideUpdateWorkerAction,
  evaluatePostReloadHandshake,
  getReloadPendingMarker,
  isPwaDismissCooldownActive,
  pwaUpdateCopy,
  setReloadPendingMarker,
  updateFlowReducer,
  waitForInstallingWorker,
  type UpdateGateState,
} from "./updateFlow";

describe("updateFlowReducer - Pure state machine for all 17 states", () => {
  it("should handle BOOTING -> CHECKING -> CURRENT for no-update without worker", () => {
    let state: UpdateGateState = "BOOTING";
    state = updateFlowReducer(state, { type: "START_CHECK" });
    assert.equal(state, "CHECKING");

    state = updateFlowReducer(state, {
      type: "CHECK_RESULT",
      status: "no-update",
      hasWorker: false,
    });
    assert.equal(state, "CURRENT");
  });

  it("should handle CHECKING -> CHECK_NETWORK_ERROR for network-failure or invalid-response", () => {
    let state: UpdateGateState = "CHECKING";
    let next = updateFlowReducer(state, {
      type: "CHECK_RESULT",
      status: "network-failure",
    });
    assert.equal(next, "CHECK_NETWORK_ERROR");

    next = updateFlowReducer(state, {
      type: "CHECK_RESULT",
      status: "invalid-response",
    });
    assert.equal(next, "CHECK_NETWORK_ERROR");
  });

  it("should handle mismatch transition to UPDATE_BLOCKING or UPDATE_DEFERRED based on route readiness", () => {
    let state: UpdateGateState = "CHECKING";
    let blocking = updateFlowReducer(state, {
      type: "CHECK_RESULT",
      status: "mismatch",
      isSafeAndReady: true,
    });
    assert.equal(blocking, "UPDATE_BLOCKING");

    let deferred = updateFlowReducer(state, {
      type: "CHECK_RESULT",
      status: "mismatch",
      isSafeAndReady: false,
    });
    assert.equal(deferred, "UPDATE_DEFERRED");
  });

  it("should handle EVALUATE_DEFERRED transitioning UPDATE_DEFERRED to UPDATE_BLOCKING when safe and ready", () => {
    let state: UpdateGateState = "UPDATE_DEFERRED";
    state = updateFlowReducer(state, {
      type: "EVALUATE_DEFERRED",
      isSafeAndReady: true,
    });
    assert.equal(state, "UPDATE_BLOCKING");
  });

  it("should handle USER_CLICK_UPDATE on UPDATE_BLOCKING to RECHECKING", () => {
    let state: UpdateGateState = "UPDATE_BLOCKING";
    state = updateFlowReducer(state, { type: "USER_CLICK_UPDATE" });
    assert.equal(state, "RECHECKING");
  });

  it("should release gate to CURRENT on RECHECK_RESULT no-update without worker", () => {
    let state: UpdateGateState = "RECHECKING";
    state = updateFlowReducer(state, {
      type: "RECHECK_RESULT",
      status: "no-update",
      hasWorker: false,
    });
    assert.equal(state, "CURRENT");
  });

  it("should transition to UPDATE_BLOCKING_ERROR on RECHECK_RESULT network-failure or invalid-response", () => {
    let state: UpdateGateState = "RECHECKING";
    let next = updateFlowReducer(state, {
      type: "RECHECK_RESULT",
      status: "network-failure",
    });
    assert.equal(next, "UPDATE_BLOCKING_ERROR");

    next = updateFlowReducer(state, {
      type: "RECHECK_RESULT",
      status: "invalid-response",
    });
    assert.equal(next, "UPDATE_BLOCKING_ERROR");
  });

  it("should handle RECHECK_RESULT mismatch -> REGISTRATION_UPDATING -> INSTALLING -> INSTALL_READY", () => {
    let state: UpdateGateState = "RECHECKING";
    state = updateFlowReducer(state, {
      type: "RECHECK_RESULT",
      status: "mismatch",
    });
    assert.equal(state, "REGISTRATION_UPDATING");

    state = updateFlowReducer(state, { type: "WORKER_FOUND_INSTALLING" });
    assert.equal(state, "INSTALLING");

    state = updateFlowReducer(state, { type: "INSTALL_SUCCESS" });
    assert.equal(state, "INSTALL_READY");
  });

  it("should handle install failure or registration error -> UPDATE_BLOCKING_ERROR", () => {
    let state: UpdateGateState = "INSTALLING";
    state = updateFlowReducer(state, { type: "INSTALL_FAILED", reason: "timeout" });
    assert.equal(state, "UPDATE_BLOCKING_ERROR");

    state = updateFlowReducer("REGISTRATION_UPDATING", {
      type: "REGISTRATION_UPDATE_ERROR",
      error: "update failed",
    });
    assert.equal(state, "UPDATE_BLOCKING_ERROR");
  });

  it("should handle consensus workflow: INSTALL_READY -> CONSENSUS_PREPARING -> ACTIVATING -> CONTROLLER_CHANGED -> RELOAD_PENDING", () => {
    let state: UpdateGateState = "INSTALL_READY";
    state = updateFlowReducer(state, { type: "START_CONSENSUS" });
    assert.equal(state, "CONSENSUS_PREPARING");

    state = updateFlowReducer(state, { type: "CONSENSUS_RESULT", ack: true });
    assert.equal(state, "ACTIVATING");

    state = updateFlowReducer(state, { type: "CONTROLLER_CHANGE_RECEIVED" });
    assert.equal(state, "CONTROLLER_CHANGED");

    state = updateFlowReducer(state, { type: "PREPARE_RELOAD" });
    assert.equal(state, "RELOAD_PENDING");
  });

  it("should defer when consensus returns NACK", () => {
    let state: UpdateGateState = "CONSENSUS_PREPARING";
    state = updateFlowReducer(state, { type: "CONSENSUS_RESULT", ack: false });
    assert.equal(state, "UPDATE_DEFERRED");
  });

  it("should forbid success transition directly at CONTROLLER_CHANGED", () => {
    let state: UpdateGateState = "CONTROLLER_CHANGED";
    // VERIFY_LATEST_RESULT success without VERIFYING_LATEST state does not change CONTROLLER_CHANGED to CURRENT
    const unexpected = updateFlowReducer(state, {
      type: "VERIFY_LATEST_RESULT",
      success: true,
    });
    assert.notEqual(unexpected, "CURRENT");
    assert.equal(unexpected, "CONTROLLER_CHANGED");
  });

  it("should handle post-reload verification workflow: VERIFYING_LATEST -> CURRENT or VERIFYING_ERROR -> retry", () => {
    let state: UpdateGateState = "VERIFYING_LATEST";
    const failureState = updateFlowReducer(state, {
      type: "VERIFY_LATEST_RESULT",
      success: false,
    });
    assert.equal(failureState, "VERIFYING_ERROR");

    const retrying = updateFlowReducer(failureState, {
      type: "USER_CLICK_RETRY_VERIFY",
    });
    assert.equal(retrying, "VERIFYING_LATEST");

    const successState = updateFlowReducer(retrying, {
      type: "VERIFY_LATEST_RESULT",
      success: true,
    });
    assert.equal(successState, "CURRENT");
  });
});

describe("waitForInstallingWorker - Event race, timeout, and redundant handling", () => {
  it("should resolve existing waiting worker immediately", async () => {
    const fakeWorker = { state: "installed" } as unknown as ServiceWorker;
    const fakeReg = { waiting: fakeWorker } as unknown as ServiceWorkerRegistration;

    const result = await waitForInstallingWorker(fakeReg, { timeoutMs: 1000 });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.worker, fakeWorker);
    }
  });

  it("should resolve when installing worker fires statechange to installed", async () => {
    const listeners: Record<string, () => void> = {};
    const fakeWorker = {
      state: "installing",
      addEventListener: (evt: string, fn: () => void) => {
        listeners[evt] = fn;
      },
      removeEventListener: (evt: string) => {
        delete listeners[evt];
      },
    } as unknown as ServiceWorker;

    const fakeReg = { installing: fakeWorker } as unknown as ServiceWorkerRegistration;

    const promise = waitForInstallingWorker(fakeReg, { timeoutMs: 2000 });

    // Simulate state change race
    (fakeWorker as unknown as { state: string }).state = "installed";
    if (listeners.statechange) listeners.statechange();

    const result = await promise;
    assert.equal(result.success, true);
  });

  it("should reject when installing worker becomes redundant", async () => {
    const listeners: Record<string, () => void> = {};
    const fakeWorker = {
      state: "installing",
      addEventListener: (evt: string, fn: () => void) => {
        listeners[evt] = fn;
      },
      removeEventListener: (evt: string) => {
        delete listeners[evt];
      },
    } as unknown as ServiceWorker;

    const fakeReg = { installing: fakeWorker } as unknown as ServiceWorkerRegistration;

    const promise = waitForInstallingWorker(fakeReg, { timeoutMs: 2000 });

    (fakeWorker as unknown as { state: string }).state = "redundant";
    if (listeners.statechange) listeners.statechange();

    const result = await promise;
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.reason, "redundant");
    }
  });

  it("should timeout when worker does not reach installed within timeoutMs", async () => {
    const fakeWorker = {
      state: "installing",
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as ServiceWorker;

    const fakeReg = { installing: fakeWorker } as unknown as ServiceWorkerRegistration;

    const result = await waitForInstallingWorker(fakeReg, { timeoutMs: 50 });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.reason, "timeout");
    }
  });

  it("should reject when target build mismatch", async () => {
    const fakeWorker = { state: "installed" } as unknown as ServiceWorker;
    const fakeReg = { waiting: fakeWorker } as unknown as ServiceWorkerRegistration;

    const result = await waitForInstallingWorker(fakeReg, {
      targetBuildId: "build-v2",
      getWorkerBuildId: async () => "build-v1", // mismatch!
      timeoutMs: 1000,
    });

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.reason, "build_mismatch");
    }
  });
});

describe("OneShotActivationTracker - One-shot activation contract", () => {
  it("should allow committing activation exactly once per proposal/worker identity", () => {
    const tracker = createOneShotActivationTracker();
    const proposalId = "prop-123";
    const workerId = "worker-abc";

    assert.equal(tracker.tryCommitActivation(proposalId, workerId), true);
    assert.equal(tracker.hasActivated(proposalId, workerId), true);

    // Second commitment attempt must fail (redundant)
    assert.equal(tracker.tryCommitActivation(proposalId, workerId), false);

    // Different proposal ID succeeds once
    assert.equal(tracker.tryCommitActivation("prop-456", workerId), true);
  });
});

describe("ReloadPendingMarker & PostReloadHandshake", () => {
  it("should correctly store, retrieve, and clear reload pending marker", () => {
    const memoryStore: Record<string, string> = {};
    const mockStorage: Storage = {
      getItem: (key: string) => memoryStore[key] || null,
      setItem: (key: string, val: string) => {
        memoryStore[key] = val;
      },
      removeItem: (key: string) => {
        delete memoryStore[key];
      },
      clear: () => {},
      key: () => null,
      length: 0,
    };

    setReloadPendingMarker(
      {
        proposalId: "p1",
        targetBuild: "build-v2",
        targetDeploymentId: "dep-2",
        startedAt: 1000,
      },
      mockStorage,
    );

    const marker = getReloadPendingMarker(mockStorage);
    assert.equal(marker?.proposalId, "p1");
    assert.equal(marker?.targetBuild, "build-v2");

    clearReloadPendingMarker(mockStorage);
    assert.equal(getReloadPendingMarker(mockStorage), null);
  });

  it("evaluatePostReloadHandshake should succeed ONLY on triple match with valid metadata", () => {
    const validMetadata = {
      buildId: "build-v1",
      buildStamp: "build-v1",
      deploymentId: "dep-1",
    };

    // Triple match: server == document == controller
    const successResult = evaluatePostReloadHandshake({
      serverMetadata: validMetadata,
      documentBuildStamp: "build-v1",
      controllerBuildId: "build-v1",
    });
    assert.equal(successResult.success, true);

    // Triple mismatch: controller build differs
    const controllerMismatch = evaluatePostReloadHandshake({
      serverMetadata: validMetadata,
      documentBuildStamp: "build-v1",
      controllerBuildId: "build-v0",
    });
    assert.equal(controllerMismatch.success, false);
    if (!controllerMismatch.success) {
      assert.equal(controllerMismatch.reason, "triple_mismatch");
    }

    // Triple mismatch: server build differs
    const serverMismatch = evaluatePostReloadHandshake({
      serverMetadata: { ...validMetadata, buildId: "build-v2", buildStamp: "build-v2" },
      documentBuildStamp: "build-v1",
      controllerBuildId: "build-v1",
    });
    assert.equal(serverMismatch.success, false);
    if (!serverMismatch.success) {
      assert.equal(serverMismatch.reason, "triple_mismatch");
    }

    // Missing controller
    const missingController = evaluatePostReloadHandshake({
      serverMetadata: validMetadata,
      documentBuildStamp: "build-v1",
      controllerBuildId: null,
    });
    assert.equal(missingController.success, false);
    if (!missingController.success) {
      assert.equal(missingController.reason, "controller_missing");
    }
  });
});

describe("pwaUpdateCopy - Exact Korean UI copy contracts", () => {
  it("should return exact mismatch copy contract", () => {
    const copy = pwaUpdateCopy("mismatch");
    assert.equal(copy.title, "새로운 버전이 준비됐어요.");
    assert.equal(copy.body, "더 안정적으로 사용하려면 먼저 앱을 업데이트해 주세요.");
    assert.equal(copy.action, "업데이트");
  });

  it("should return exact failure copy contract for failure, offline, and error", () => {
    const failureCopy = pwaUpdateCopy("failure");
    assert.equal(failureCopy.title, "새로운 버전이 준비됐어요.");
    assert.equal(
      failureCopy.body,
      "업데이트 중 문제가 생겼어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
    );
    assert.equal(failureCopy.action, "다시 시도");

    const offlineCopy = pwaUpdateCopy("offline");
    assert.equal(
      offlineCopy.body,
      "업데이트 중 문제가 생겼어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
    );

    const errorCopy = pwaUpdateCopy("error");
    assert.equal(
      errorCopy.body,
      "업데이트 중 문제가 생겼어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
    );
  });
});
