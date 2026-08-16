import test from "node:test";
import assert from "node:assert/strict";
import {
  parseActivationProposal,
  createActivationProposal,
  getActivationProposal,
  clearActivationProposal,
  getOrCreateTabId,
  isPwaGetIdentityRequest,
  isPwaIdentityResponse,
  isPwaPrepareActivationRequest,
  isPwaTabPrepareRequest,
  isPwaTabVoteAckResponse,
  isPwaTabVoteNackResponse,
  evaluateTabVote,
  isValidStaleAssetPath,
  validateStaleAssetEnvelope,
  PWA_ACTIVATION_PROPOSAL_STORAGE_KEY,
  ActivationProposal,
} from "./tabUpdateConsensus";

class MockStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

test("parseActivationProposal - strict schema and expiration checks", () => {
  const now = 100000;
  const validProposal: ActivationProposal = {
    protocol: 1,
    proposalId: "12345678-1234-4234-8234-123456789abc",
    ownerTabId: "87654321-4321-4321-8321-cba987654321",
    fromBuild: "build-v1",
    targetBuild: "build-v2",
    targetSwVersion: "kbestie-shell-build-v2",
    workerNonce: "nonce-w123",
    createdAt: now - 5000,
    expiresAt: now + 25000,
  };

  assert.deepEqual(parseActivationProposal(validProposal, now), validProposal);
  assert.deepEqual(parseActivationProposal(JSON.stringify(validProposal), now), validProposal);

  // Reject expired proposal
  assert.equal(parseActivationProposal(validProposal, now + 30000), null);

  // Reject invalid protocol
  assert.equal(parseActivationProposal({ ...validProposal, protocol: 2 }, now), null);

  // Reject invalid UUIDs
  assert.equal(parseActivationProposal({ ...validProposal, proposalId: "not-a-uuid" }, now), null);
  assert.equal(parseActivationProposal({ ...validProposal, ownerTabId: "" }, now), null);

  // Reject empty targetBuild or workerNonce
  assert.equal(parseActivationProposal({ ...validProposal, targetBuild: "  " }, now), null);
  assert.equal(parseActivationProposal({ ...validProposal, workerNonce: "" }, now), null);

  // Reject invalid timestamps
  assert.equal(parseActivationProposal({ ...validProposal, createdAt: -1 }, now), null);
  assert.equal(parseActivationProposal({ ...validProposal, expiresAt: 5000 }, now), null);
});

test("createActivationProposal & CAS write read-back logic", () => {
  const storage = new MockStorage();
  const now = 100000;
  const ownerTabId = "11111111-2222-4333-8444-555555555555";
  const otherTabId = "99999999-8888-4777-8666-555555555555";

  const created = createActivationProposal(
    {
      ownerTabId,
      targetBuild: "build-target-1",
      workerNonce: "nonce-1",
      fromBuild: "build-from-1",
      ttlMs: 10000,
    },
    storage,
    now
  );

  assert.notEqual(created, null);
  assert.equal(created?.ownerTabId, ownerTabId);
  assert.equal(created?.targetBuild, "build-target-1");
  assert.equal(created?.workerNonce, "nonce-1");
  assert.equal(created?.fromBuild, "build-from-1");
  assert.equal(created?.expiresAt, now + 10000);

  const stored = getActivationProposal(storage, now);
  assert.deepEqual(stored, created);

  // CAS write readback opens owner barrier
  const { isActivationBarrierActive } = require("./conversationActivity");
  assert.equal(isActivationBarrierActive(), true);

  // CAS: Trying to create proposal from another tab when live proposal exists should fail
  const blocked = createActivationProposal(
    {
      ownerTabId: otherTabId,
      targetBuild: "build-target-2",
      workerNonce: "nonce-2",
    },
    storage,
    now + 1000
  );
  assert.equal(blocked, null);

  clearActivationProposal(storage);
  assert.equal(getActivationProposal(storage, now), null);

  storage.setItem(
    PWA_ACTIVATION_PROPOSAL_STORAGE_KEY,
    JSON.stringify({ ...created, expiresAt: now + 5000 })
  );
  assert.equal(getActivationProposal(storage, now + 6000), null);

  const allowedAfterExpiry = createActivationProposal(
    {
      ownerTabId: otherTabId,
      targetBuild: "build-target-2",
      workerNonce: "nonce-2",
    },
    storage,
    now + 7000
  );
  assert.notEqual(allowedAfterExpiry, null);
  assert.equal(allowedAfterExpiry?.ownerTabId, otherTabId);
});

test("getOrCreateTabId - sessionStorage helper", () => {
  const storage = new MockStorage();
  const id1 = getOrCreateTabId(storage);
  assert.match(id1, /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

  const id2 = getOrCreateTabId(storage);
  assert.equal(id2, id1);
});

test("Message envelopes & type guards", () => {
  const requestNonce = "req-12345";
  const proposalId = "12345678-1234-4234-8234-123456789abc";
  const ownerTabId = "87654321-4321-4321-8321-cba987654321";
  const passId = "abcdef01-2345-4678-8bcd-ef0123456789";
  const voteNonce = "98765432-10fe-4cba-8876-543210fedcba";

  const getIdentityReq = { protocol: 1, type: "PWA_GET_IDENTITY", requestNonce };
  assert.equal(isPwaGetIdentityRequest(getIdentityReq), true);
  assert.equal(isPwaGetIdentityRequest({ ...getIdentityReq, protocol: 2 }), false);

  const identityRes = {
    protocol: 1,
    type: "PWA_IDENTITY_RESPONSE",
    requestNonce,
    buildId: "b-100",
    swVersion: "kbestie-shell-b-100",
    workerNonce: "w-nonce-1",
  };
  assert.equal(isPwaIdentityResponse(identityRes, requestNonce), true);
  assert.equal(isPwaIdentityResponse(identityRes, "wrong-nonce"), false);

  const proposal: ActivationProposal = {
    protocol: 1,
    proposalId,
    ownerTabId,
    targetBuild: "b-100",
    workerNonce: "w-nonce-1",
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 50000,
  };

  const prepareActReq = { protocol: 1, type: "PWA_PREPARE_ACTIVATION", requestNonce, proposal };
  assert.equal(isPwaPrepareActivationRequest(prepareActReq), true);

  const tabPrepareReq = {
    protocol: 1,
    type: "PWA_TAB_PREPARE",
    requestNonce,
    proposal,
    passId,
    voteNonce,
    targetBuild: "b-100",
    targetSwVersion: "kbestie-shell-b-100",
    workerNonce: "w-nonce-1",
    expiresAt: proposal.expiresAt,
  };
  assert.equal(isPwaTabPrepareRequest(tabPrepareReq), true);

  const voteAck = {
    protocol: 1,
    type: "PWA_TAB_ACK",
    requestNonce,
    proposalId,
    passId,
    voteNonce,
    status: "ACK_SAFE",
  };
  assert.equal(isPwaTabVoteAckResponse(voteAck), true);

  const voteNack = {
    protocol: 1,
    type: "PWA_TAB_NACK",
    requestNonce,
    proposalId,
    passId,
    voteNonce,
    status: "NACK_ACTIVE",
    reason: "Conversation active",
  };
  assert.equal(isPwaTabVoteNackResponse(voteNack), true);
});

test("evaluateTabVote - Pure page vote evaluation", () => {
  const proposalId = "12345678-1234-4234-8234-123456789abc";
  const ownerTabId = "87654321-4321-4321-8321-cba987654321";
  const passId = "abcdef01-2345-4678-8bcd-ef0123456789";
  const voteNonce = "98765432-10fe-4cba-8876-543210fedcba";
  const now = 100000;

  const proposal: ActivationProposal = {
    protocol: 1,
    proposalId,
    ownerTabId,
    fromBuild: "build-v1",
    targetBuild: "build-v2",
    workerNonce: "nonce-w1",
    createdAt: now - 1000,
    expiresAt: now + 20000,
  };

  // 1. Safe route & ready -> ACK_SAFE (PWA_TAB_ACK without clientId)
  const ack = evaluateTabVote({
    requestNonce: "req-1",
    passId,
    voteNonce,
    proposal,
    pathname: "/parent/home",
    isConversationActive: false,
    documentBuildId: "build-v1",
    now,
  });
  assert.equal(ack.type, "PWA_TAB_ACK");
  assert.equal(ack.status, "ACK_SAFE");
  assert.equal(ack.passId, passId);
  assert.equal(ack.voteNonce, voteNonce);

  // 2. Active conversation hazard -> NACK_ACTIVE
  const nackActive = evaluateTabVote({
    requestNonce: "req-1",
    passId,
    voteNonce,
    proposal,
    pathname: "/parent/home",
    isConversationActive: true,
    documentBuildId: "build-v1",
    now,
  });
  assert.equal(nackActive.type, "PWA_TAB_NACK");
  assert.equal(nackActive.status, "NACK_ACTIVE");

  // 3. Hazard count > 0 -> NACK_ACTIVE
  const nackHazards = evaluateTabVote({
    requestNonce: "req-1",
    passId,
    voteNonce,
    proposal,
    pathname: "/parent/home",
    isConversationActive: false,
    hazardsCount: 1,
    documentBuildId: "build-v1",
    now,
  });
  assert.equal(nackHazards.status, "NACK_ACTIVE");

  // 4. Unsafe route (e.g. /chat or /parent/settings) -> NACK_NOT_READY
  const nackUnsafeRoute = evaluateTabVote({
    requestNonce: "req-1",
    passId,
    voteNonce,
    proposal,
    pathname: "/chat",
    isConversationActive: false,
    documentBuildId: "build-v1",
    now,
  });
  assert.equal(nackUnsafeRoute.status, "NACK_NOT_READY");

  // 5. Document build mismatch -> NACK_MISMATCH
  const nackBuildMismatch = evaluateTabVote({
    requestNonce: "req-1",
    passId,
    voteNonce,
    proposal,
    pathname: "/parent/home",
    isConversationActive: false,
    documentBuildId: "build-v0-old",
    now,
  });
  assert.equal(nackBuildMismatch.status, "NACK_MISMATCH");

  // 6. Active proposal ID mismatch -> NACK_MISMATCH
  const nackProposalMismatch = evaluateTabVote({
    requestNonce: "req-1",
    passId,
    voteNonce,
    proposal,
    pathname: "/parent/home",
    isConversationActive: false,
    documentBuildId: "build-v1",
    activeProposalId: "99999999-8888-4777-8666-555555555555",
    now,
  });
  assert.equal(nackProposalMismatch.status, "NACK_MISMATCH");

  // 7. Expired proposal -> NACK_EXPIRED
  const nackExpired = evaluateTabVote({
    requestNonce: "req-1",
    passId,
    voteNonce,
    proposal,
    pathname: "/parent/home",
    isConversationActive: false,
    documentBuildId: "build-v1",
    now: now + 30000,
  });
  assert.equal(nackExpired.status, "NACK_EXPIRED");
});

test("StaleAssetEnvelope - Strict path and envelope validation", () => {
  assert.equal(isValidStaleAssetPath("/_next/static/chunks/main.js"), true);
  assert.equal(isValidStaleAssetPath("/_next/static/css/app.css"), true);

  assert.equal(isValidStaleAssetPath("/_next/static/chunks/main.js?v=1"), false);
  assert.equal(isValidStaleAssetPath("/_next/static/chunks/main.js#hash"), false);
  assert.equal(isValidStaleAssetPath("/_next/static/chunks/main\x00.js"), false);
  assert.equal(isValidStaleAssetPath("/api/pwa/sw"), false);
  assert.equal(isValidStaleAssetPath("/offline"), false);

  const validEnvelope = {
    protocol: 1,
    type: "K_STALE_ASSET",
    requestNonce: "req-stale-1",
    buildId: "build-v1",
    workerNonce: "nonce-worker-1",
    pathname: "/_next/static/chunks/app.js",
    status: 404,
  };

  const validated = validateStaleAssetEnvelope(validEnvelope, {
    controllerBuildId: "build-v1",
    controllerNonce: "nonce-worker-1",
  });
  assert.deepEqual(validated, validEnvelope);

  assert.equal(
    validateStaleAssetEnvelope(validEnvelope, { controllerBuildId: "wrong-build" }),
    null
  );
  assert.equal(
    validateStaleAssetEnvelope(validEnvelope, { controllerNonce: "wrong-nonce" }),
    null
  );

  assert.equal(validateStaleAssetEnvelope({ ...validEnvelope, status: 200 }), null);
  assert.equal(validateStaleAssetEnvelope({ ...validEnvelope, type: "OTHER_TYPE" }), null);
});
