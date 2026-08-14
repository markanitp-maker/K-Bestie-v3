import test from "node:test";
import assert from "node:assert/strict";
import {
  openActivationBarrier,
  commitActivationBarrier,
  abortActivationBarrier,
  clearActivationBarrier,
  transferCommittedBarrierToBlockingError,
  getActivationBarrierState,
  isActivationBarrierActive,
  getCentralBlockingError,
  clearCentralBlockingError,
  restoreActivationBarrierFromStorage,
  subscribeActivationBarrier,
  reduceActivationBarrier,
  tryAcquireConversationHazard,
  acquireHazardToken,
  releaseAllHazardsForSource,
  isConversationActive,
  getConversationActivitySnapshot,
  setConversationActivityReady,
  resetConversationActivityStateForTest,
  PWA_ACTIVATION_PROPOSAL_STORAGE_KEY,
  ActivationBarrierState,
} from "./conversationActivity";
import { LatestVersionMetadataV1 } from "./clientVersion";

const mockTargetV1: LatestVersionMetadataV1 = {
  schemaVersion: 1,
  buildId: "build-A",
  buildStamp: "stamp-A",
  deploymentId: "deploy-A",
  swVersion: "kbestie-shell-A",
  serviceWorkerScriptUrl: "/sw.js",
};

test("Activation Barrier - Open, Commit, Abort, Expiry, Replacement lifecycle", async () => {
  resetConversationActivityStateForTest();

  const now = Date.now();
  const proposalA = {
    proposalId: "11111111-1111-4111-8111-111111111111",
    targetBuild: "build-A",
    target: mockTargetV1,
    expiresAt: now + 500,
  };

  assert.equal(isActivationBarrierActive(), false);

  // 1. Open barrier
  openActivationBarrier(proposalA);
  assert.equal(isActivationBarrierActive(), true);
  let state = getActivationBarrierState();
  assert.equal(state.active, true);
  assert.equal(state.status, "preparing");
  assert.equal(state.proposalId, proposalA.proposalId);
  assert.equal(state.phase, "preparing");
  assert.deepEqual(state.target, mockTargetV1);

  // 2. Commit barrier (sets status=committed, phase=committed, keeps active=true)
  commitActivationBarrier(proposalA.proposalId);
  state = getActivationBarrierState();
  assert.equal(state.active, true);
  assert.equal(state.status, "committed");
  assert.equal(state.phase, "committed");

  // 3. Stale abort on different proposal ID has no effect
  abortActivationBarrier("different-id");
  assert.equal(isActivationBarrierActive(), true);
  assert.equal(getActivationBarrierState().status, "committed");

  // 4. Clear with matching proposal ID
  clearActivationBarrier(proposalA.proposalId);
  assert.equal(isActivationBarrierActive(), false);
  assert.equal(getActivationBarrierState().status, "closed");

  // 5. Expiry handling: open a short-lived proposal and wait for expiry
  const proposalShort = {
    proposalId: "22222222-2222-4222-8222-222222222222",
    targetBuild: "build-short",
    expiresAt: Date.now() + 50,
  };
  openActivationBarrier(proposalShort);
  assert.equal(isActivationBarrierActive(), true);

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(isActivationBarrierActive(), false);
  assert.equal(getActivationBarrierState().status, "closed");

  // 6. Stale timer from old proposal does NOT clear a newer replacement proposal
  const proposalOld = {
    proposalId: "33333333-3333-4333-8333-333333333333",
    targetBuild: "build-old",
    expiresAt: Date.now() + 60,
  };
  openActivationBarrier(proposalOld);

  const proposalNew = {
    proposalId: "44444444-4444-4444-8444-444444444444",
    targetBuild: "build-new",
    expiresAt: Date.now() + 300,
  };
  // Immediately replace with proposalNew
  openActivationBarrier(proposalNew);
  assert.equal(getActivationBarrierState().proposalId, proposalNew.proposalId);

  // Wait past old proposal's expiry
  await new Promise((resolve) => setTimeout(resolve, 80));
  // New proposal must remain active
  assert.equal(isActivationBarrierActive(), true);
  assert.equal(getActivationBarrierState().proposalId, proposalNew.proposalId);
  assert.equal(getActivationBarrierState().status, "preparing");

  clearActivationBarrier();
  resetConversationActivityStateForTest();
});
test("Activation Barrier - Storage restore, committed persistence & subscriber unmount safety", () => {
  resetConversationActivityStateForTest();

  const mockStorageData = new Map<string, string>();
  const mockStorage: Storage = {
    getItem: (key: string) => mockStorageData.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mockStorageData.set(key, value);
    },
    removeItem: (key: string) => {
      mockStorageData.delete(key);
    },
    clear: () => mockStorageData.clear(),
    key: (index: number) => Array.from(mockStorageData.keys())[index] ?? null,
    length: mockStorageData.size,
  };

  const now = Date.now();
  const validProposal = {
    protocol: 1,
    proposalId: "55555555-5555-4555-8555-555555555555",
    ownerTabId: "66666666-6666-4666-8666-666666666666",
    targetBuild: "build-store-1",
    target: mockTargetV1,
    workerNonce: "nonce-w",
    createdAt: now - 1000,
    expiresAt: now + 30000,
  };

  mockStorage.setItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY, JSON.stringify(validProposal));

  // 1. Restore from storage -> opens preparing barrier
  const restored = restoreActivationBarrierFromStorage(mockStorage, now);
  assert.equal(restored.active, true);
  assert.equal(restored.status, "preparing");
  assert.equal(restored.proposalId, validProposal.proposalId);

  // 2. Commit barrier
  commitActivationBarrier(validProposal.proposalId);
  assert.equal(getActivationBarrierState().status, "committed");

  // 3. Storage removal during committed state does NOT wipe committed barrier (persists through reload!)
  mockStorage.removeItem(PWA_ACTIVATION_PROPOSAL_STORAGE_KEY);
  restoreActivationBarrierFromStorage(mockStorage, now + 100);
  assert.equal(isActivationBarrierActive(), true);
  assert.equal(getActivationBarrierState().status, "committed");

  // 4. Subscribe and Unsubscribe
  let listenerCalls = 0;
  const unsubscribe = subscribeActivationBarrier(() => {
    listenerCalls += 1;
  });
  assert.ok(listenerCalls >= 1);

  // Unmounting / unsubscribing must NOT clear the active proposal barrier!
  unsubscribe();
  assert.equal(isActivationBarrierActive(), true);

  // 5. Transfer committed barrier to central blocking error upon verification failure
  assert.equal(getCentralBlockingError(), null);
  transferCommittedBarrierToBlockingError(validProposal.proposalId, "verification_mismatch");
  assert.equal(getCentralBlockingError(), "verification_mismatch");
  assert.equal(isActivationBarrierActive(), false);
  assert.equal(getActivationBarrierState().status, "closed");

  clearCentralBlockingError();
  resetConversationActivityStateForTest();
});

test("Synchronous Race Prevention: tryAcquireConversationHazard & Activation Barrier", () => {
  resetConversationActivityStateForTest();

  // 1. When barrier is NOT active, tryAcquireConversationHazard succeeds synchronously
  const token1 = tryAcquireConversationHazard("chat", "turn_in_flight");
  assert.notEqual(token1, null);
  assert.equal(isConversationActive(), true);
  assert.equal(getConversationActivitySnapshot().hazardsCount, 1);

  // 2. While hazard is active, barrier opens:
  const now = Date.now();
  openActivationBarrier({
    proposalId: "77777777-7777-4777-8777-777777777777",
    targetBuild: "build-race-1",
    expiresAt: now + 10000,
  });

  // Now barrier is active: new attempts to start conversations must fail synchronously
  const token2 = tryAcquireConversationHazard("mission", "new_mission_start");
  assert.equal(token2, null);

  // 3. Releasing previous hazard token
  token1?.release();
  assert.equal(isConversationActive(), false);
  assert.equal(getConversationActivitySnapshot().hazardsCount, 0);

  // Attempting to start conversation while barrier is active still fails
  const token3 = tryAcquireConversationHazard("chat", "start_after_finish");
  assert.equal(token3, null);

  // 4. Once barrier is aborted/cleared, new hazard starts succeed again
  abortActivationBarrier("77777777-7777-4777-8777-777777777777");
  const token4 = tryAcquireConversationHazard("chat", "start_after_abort");
  assert.notEqual(token4, null);
  assert.equal(isConversationActive(), true);

  token4?.release();
  assert.equal(isConversationActive(), false);

  resetConversationActivityStateForTest();
});

test("Conversation Activity Readiness, Force-Acquire Token & Source Release", () => {
  resetConversationActivityStateForTest();

  assert.equal(getConversationActivitySnapshot().ready, true);
  setConversationActivityReady(false);
  assert.equal(getConversationActivitySnapshot().ready, false);
  setConversationActivityReady(true);
  assert.equal(getConversationActivitySnapshot().ready, true);

  // Force-acquire token (for ongoing operations that must be registered even if barrier is up)
  const tokenA = acquireHazardToken("settlement", "reward_settlement_in_flight");
  const tokenB = acquireHazardToken("settlement", "reward_modal_open");
  assert.equal(isConversationActive(), true);
  assert.equal(getConversationActivitySnapshot().hazardsCount, 2);
  assert.equal(getConversationActivitySnapshot().hazards["settlement"]?.length, 2);

  // Release all for source
  releaseAllHazardsForSource("settlement");
  assert.equal(isConversationActive(), false);
  assert.equal(getConversationActivitySnapshot().hazardsCount, 0);

  resetConversationActivityStateForTest();
});

test("Pure Reducer: reduceActivationBarrier transitions and edge cases", () => {
  const initial: ActivationBarrierState = {
    active: false,
    status: "closed",
    proposalId: null,
    targetBuild: null,
    target: null,
    phase: null,
    expiresAt: null,
    error: null,
  };

  const now = 100000;

  // 1. PREPARE from closed
  const preparing = reduceActivationBarrier(
    initial,
    {
      type: "PREPARE",
      proposalId: "p1",
      targetBuild: "b1",
      target: mockTargetV1,
      expiresAt: now + 5000,
    },
    now
  );
  assert.equal(preparing.active, true);
  assert.equal(preparing.status, "preparing");
  assert.equal(preparing.phase, "preparing");
  assert.equal(preparing.proposalId, "p1");

  // 2. COMMIT on preparing
  const committed = reduceActivationBarrier(preparing, { type: "COMMIT", proposalId: "p1" }, now);
  assert.equal(committed.active, true);
  assert.equal(committed.status, "committed");
  assert.equal(committed.phase, "committed");

  // 3. PREPARE on committed does NOT downgrade to preparing
  const prepOnCommitted = reduceActivationBarrier(
    committed,
    {
      type: "PREPARE",
      proposalId: "p1",
      targetBuild: "b1",
      expiresAt: now + 6000,
    },
    now
  );
  assert.equal(prepOnCommitted.status, "committed");
  assert.equal(prepOnCommitted.phase, "committed");
  assert.equal(prepOnCommitted.expiresAt, now + 6000);

  // 4. Stale commit / abort with wrong proposalId has no effect
  assert.deepEqual(
    reduceActivationBarrier(committed, { type: "COMMIT", proposalId: "p-wrong" }, now),
    committed
  );
  assert.deepEqual(
    reduceActivationBarrier(committed, { type: "ABORT", proposalId: "p-wrong" }, now),
    committed
  );

  // 5. STORAGE_REMOVE does not clear committed state
  assert.deepEqual(
    reduceActivationBarrier(committed, { type: "STORAGE_REMOVE" }, now),
    committed
  );

  // 6. STORAGE_REMOVE clears preparing state
  const closedFromStorage = reduceActivationBarrier(preparing, { type: "STORAGE_REMOVE" }, now);
  assert.equal(closedFromStorage.active, false);
  assert.equal(closedFromStorage.status, "closed");

  // 7. EXPIRY_TIMER on committed transfers to error
  const expiredCommitted = reduceActivationBarrier(
    committed,
    { type: "EXPIRY_TIMER", proposalId: "p1", now: now + 10000 },
    now + 10000
  );
  assert.equal(expiredCommitted.active, false);
  assert.equal(expiredCommitted.status, "closed");
  assert.equal(expiredCommitted.error, "committed_barrier_expired");
});

test("Production PREPARE blocks Mission & FreeChat hazard token acquisition", () => {
  resetConversationActivityStateForTest();

  // Ensure production environment behavior: barrier is active on PREPARE
  const proposal = {
    proposalId: "88888888-8888-4888-8888-888888888888",
    targetBuild: "build-prod-v2",
    target: mockTargetV1,
    expiresAt: Date.now() + 30000,
  };

  openActivationBarrier(proposal, "preparing");
  assert.equal(isActivationBarrierActive(), true);

  // Both Mission and FreeChat start attempts are synchronously rejected
  const missionToken = tryAcquireConversationHazard("mission", "mission_start_attempt");
  assert.equal(missionToken, null);

  const freeChatToken = tryAcquireConversationHazard("chat", "free_chat_start_attempt");
  assert.equal(freeChatToken, null);

  assert.equal(isConversationActive(), false);
  assert.equal(getConversationActivitySnapshot().hazardsCount, 0);

  // Abort barrier -> Mission and FreeChat can start again
  abortActivationBarrier(proposal.proposalId);
  assert.equal(isActivationBarrierActive(), false);

  const validMissionToken = tryAcquireConversationHazard("mission", "mission_start_success");
  assert.notEqual(validMissionToken, null);
  assert.equal(isConversationActive(), true);

  validMissionToken?.release();
  assert.equal(isConversationActive(), false);

  resetConversationActivityStateForTest();
});
