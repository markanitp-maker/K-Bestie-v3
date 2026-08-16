import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  acquireHazardToken,
  releaseHazardToken,
  setConversationActivityReady,
  setActivationBarrier,
  isActivationBarrierActive,
  openActivationBarrier,
  commitActivationBarrier,
  clearActivationBarrier,
  getActivationBarrierState,
  tryAcquireConversationHazard,
  subscribeActivationBarrier,
  publishConversationActivity,
  subscribeConversationActivity,
  getConversationActivitySnapshot,
  isConversationActive,
  _resetConversationActivityStoreForTest,
  type ConversationActivitySnapshot,
} from "./conversationActivity";

beforeEach(() => {
  _resetConversationActivityStoreForTest();
});

test("conversationActivity - tokenized hazards acquire/release idempotently", () => {
  assert.equal(isConversationActive(), false);
  assert.equal(getConversationActivitySnapshot().isAnyActive, false);
  assert.deepEqual(getConversationActivitySnapshot().hazards, {});

  const release1 = acquireHazardToken("mission", "starting");
  const release2 = acquireHazardToken("mission", "turn_persistence");

  assert.equal(isConversationActive(), true);
  const snap1 = getConversationActivitySnapshot();
  assert.equal(snap1.isAnyActive, true);
  assert.deepEqual(snap1.hazards.mission, ["starting", "turn_persistence"]);

  // Idempotent release of token 1
  release1();
  release1(); // second call should be no-op

  const snap2 = getConversationActivitySnapshot();
  assert.equal(snap2.isAnyActive, true);
  assert.deepEqual(snap2.hazards.mission, ["turn_persistence"]);

  // Release token 2
  release2();
  const snap3 = getConversationActivitySnapshot();
  assert.equal(snap3.isAnyActive, false);
  assert.deepEqual(snap3.hazards, {});
});

test("conversationActivity - singleton activation barrier full lifecycle", () => {
  const now = 1_000_000;
  const prop1 = {
    proposalId: "p-1001",
    targetBuild: "b-v2",
    expiresAt: now + 30_000,
  };

  assert.equal(isActivationBarrierActive(), false);
  const opened = openActivationBarrier(prop1, now);
  assert.equal(opened, true);
  assert.equal(isActivationBarrierActive(), true);

  const state1 = getActivationBarrierState();
  assert.equal(state1.proposalId, "p-1001");
  assert.equal(state1.phase, "preparing");
  assert.equal(state1.targetBuild, "b-v2");

  // Attempt clearing with wrong proposalId - MUST NOT CLEAR
  clearActivationBarrier("p-other-wrong");
  assert.equal(isActivationBarrierActive(), true);
  assert.equal(getActivationBarrierState().proposalId, "p-1001");

  // Commit barrier
  commitActivationBarrier("p-1001");
  const state2 = getActivationBarrierState();
  assert.equal(state2.phase, "committed");
  assert.equal(state2.active, true);

  // Clear matching proposalId
  clearActivationBarrier("p-1001");
  assert.equal(isActivationBarrierActive(), false);
  assert.equal(getActivationBarrierState().proposalId, null);
});

test("conversationActivity - atomic tryAcquireConversationHazard", () => {
  // 1. When barrier is inactive, tryAcquireConversationHazard acquires token synchronously
  const release = tryAcquireConversationHazard("mission", "user_start");
  assert.notEqual(release, null);
  assert.equal(isConversationActive(), true);

  // Release token
  release!();
  assert.equal(isConversationActive(), false);

  // 2. Open barrier
  openActivationBarrier({
    proposalId: "p-2001",
    targetBuild: "b-v2",
    expiresAt: Date.now() + 30_000,
  });

  // When barrier is active, tryAcquireConversationHazard returns null atomically
  const releaseBlocked = tryAcquireConversationHazard("mission", "user_start");
  assert.equal(releaseBlocked, null);
  assert.equal(isConversationActive(), false);
});

test("conversationActivity - listener unmount does not clear live proposal", () => {
  const unsubBarrier = subscribeActivationBarrier(() => {});
  const unsubActivity = subscribeConversationActivity(() => {});

  openActivationBarrier({
    proposalId: "p-3001",
    targetBuild: "b-v3",
    expiresAt: Date.now() + 30_000,
  });
  assert.equal(isActivationBarrierActive(), true);

  // Unmount subscribers
  unsubBarrier();
  unsubActivity();

  // Barrier remains OPEN
  assert.equal(isActivationBarrierActive(), true);
  assert.equal(getActivationBarrierState().proposalId, "p-3001");
});

test("conversationActivity - legacy publishConversationActivity compatibility", () => {
  publishConversationActivity("mission", true);
  assert.equal(isConversationActive(), true);
  assert.deepEqual(getConversationActivitySnapshot().hazards.mission, ["active"]);

  publishConversationActivity("mission", false);
  assert.equal(isConversationActive(), false);
});
