import test from "node:test";
import assert from "node:assert/strict";
import {
  parseActivationProposalLease,
  createActivationProposal,
  getActivationProposal,
  clearActivationProposal,
  abortActivationProposal,
  commitActivationProposal,
  getOrCreateTabId,
  isPwaGetIdentityRequest,
  isPwaIdentityResponse,
  isPwaPrepareActivationRequest,
  isPwaTabPrepareRequest,
  isPwaTabVoteAckResponse,
  isPwaTabVoteNackResponse,
  isStrictPwaTabVoteAck,
  isStrictPwaTabVoteNack,
  evaluateTabVote,
  isValidStaleAssetPath,
  validateStaleAssetEnvelope,
  PWA_ACTIVATION_PROPOSAL_STORAGE_KEY,
  ActivationProposal,
} from "./tabUpdateConsensus";
import { LatestVersionMetadataV1 } from "./clientVersion";

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

const mockTargetV1: LatestVersionMetadataV1 = {
  schemaVersion: 1,
  buildId: "build-target-1",
  buildStamp: "stamp-target-1",
  deploymentId: "deploy-target-1",
  swVersion: "kbestie-shell-target-1",
  serviceWorkerScriptUrl: "/sw.js",
};

const mockTargetV2: LatestVersionMetadataV1 = {
  schemaVersion: 1,
  buildId: "build-target-2",
  buildStamp: "stamp-target-2",
  deploymentId: "deploy-target-2",
  swVersion: "kbestie-shell-target-2",
  serviceWorkerScriptUrl: "/sw.js",
};

test("parseActivationProposalLease - strict schema, target metadata and expiration checks", () => {
  const now = 100000;
  const validProposal: ActivationProposal = {
    protocol: 1,
    proposalId: "12345678-1234-4234-8234-123456789abc",
    ownerTabId: "87654321-4321-4321-8321-cba987654321",
    fromBuild: "build-v1",
    targetBuild: "build-target-1",
    targetSwVersion: "kbestie-shell-target-1",
    targetScriptUrl: "/sw.js",
    serviceWorkerScriptUrl: "/sw.js",
    target: mockTargetV1,
    workerNonce: "nonce-w123",
    createdAt: now - 5000,
    expiresAt: now + 25000,
  };

  assert.deepEqual(parseActivationProposalLease(validProposal, now), validProposal);
  assert.deepEqual(parseActivationProposalLease(JSON.stringify(validProposal), now), validProposal);

  // Reject expired proposal
  assert.equal(parseActivationProposalLease(validProposal, now + 30000), null);

  // Reject invalid protocol or schemaVersion
  assert.equal(parseActivationProposalLease({ ...validProposal, protocol: 2, schemaVersion: 2 }, now), null);

  // Reject invalid UUIDs
  assert.equal(parseActivationProposalLease({ ...validProposal, proposalId: "not-a-uuid" }, now), null);
  assert.equal(parseActivationProposalLease({ ...validProposal, ownerTabId: "" }, now), null);

  // Reject empty targetBuild or workerNonce
  assert.equal(parseActivationProposalLease({ ...validProposal, targetBuild: "  ", target: undefined }, now), null);
  assert.equal(parseActivationProposalLease({ ...validProposal, workerNonce: "" }, now), null);

  // Reject invalid timestamps
  assert.equal(parseActivationProposalLease({ ...validProposal, createdAt: -1 }, now), null);
  assert.equal(parseActivationProposalLease({ ...validProposal, expiresAt: 5000 }, now), null);

  // Schema version 1 lease format is parsed correctly
  const schemaV1Lease = {
    schemaVersion: 1,
    proposalId: "12345678-1234-4234-8234-123456789abc",
    ownerTabId: "87654321-4321-4321-8321-cba987654321",
    target: mockTargetV1,
    workerNonce: "nonce-w123",
    createdAt: now - 1000,
    expiresAt: now + 20000,
  };
  const parsedSchemaV1 = parseActivationProposalLease(schemaV1Lease, now);
  assert.notEqual(parsedSchemaV1, null);
  assert.equal(parsedSchemaV1?.targetBuild, mockTargetV1.buildId);
});

test("createActivationProposal - Lease reuse, target competition, owner crash and strict CAS", () => {
  const storage = new MockStorage();
  const now = 100000;
  const ownerTabA = "11111111-2222-4333-8444-555555555555";
  const otherTabB = "22222222-3333-4444-8555-666666666666";
  const otherTabC = "33333333-4444-4555-8666-777777777777";

  // 1. Tab A creates a proposal for target V1
  const proposalA = createActivationProposal(
    {
      ownerTabId: ownerTabA,
      target: mockTargetV1,
      workerNonce: "nonce-w1",
      fromBuild: "build-from-1",
      ttlMs: 10000,
    },
    storage,
    now
  );

  assert.notEqual(proposalA, null);
  assert.equal(proposalA?.ownerTabId, ownerTabA);
  assert.equal(proposalA?.targetBuild, "build-target-1");
  assert.equal(proposalA?.workerNonce, "nonce-w1");
  assert.equal(proposalA?.fromBuild, "build-from-1");
  assert.equal(proposalA?.expiresAt, now + 10000);

  // 2. Tab B requests the exact same target + workerNonce -> REUSES Tab A's proposal
  const reusedByTabB = createActivationProposal(
    {
      ownerTabId: otherTabB,
      target: mockTargetV1,
      workerNonce: "nonce-w1",
      fromBuild: "build-from-1",
      ttlMs: 10000,
    },
    storage,
    now + 1000
  );

  assert.notEqual(reusedByTabB, null);
  assert.equal(reusedByTabB?.proposalId, proposalA?.proposalId);
  assert.equal(reusedByTabB?.ownerTabId, ownerTabA); // Retains original ownerTabId

  // 3. Tab C requests a DIFFERENT target -> MUST WAIT (returns null, cannot overwrite)
  const blockedDifferentTarget = createActivationProposal(
    {
      ownerTabId: otherTabC,
      target: mockTargetV2,
      workerNonce: "nonce-w1",
      fromBuild: "build-from-1",
      ttlMs: 10000,
    },
    storage,
    now + 2000
  );
  assert.equal(blockedDifferentTarget, null);

  // 4. Tab C requests DIFFERENT workerNonce for same target -> MUST WAIT (returns null)
  const blockedDifferentNonce = createActivationProposal(
    {
      ownerTabId: otherTabC,
      target: mockTargetV1,
      workerNonce: "nonce-w2-different",
      fromBuild: "build-from-1",
      ttlMs: 10000,
    },
    storage,
    now + 2000
  );
  assert.equal(blockedDifferentNonce, null);

  // 5. Non-owner cannot abort or clear unexpired proposal
  const abortByNonOwner = abortActivationProposal(proposalA!.proposalId, otherTabB, storage, now + 3000);
  assert.equal(abortByNonOwner, false);
  assert.notEqual(getActivationProposal(storage, now + 3000), null);

  const clearByNonOwner = clearActivationProposal(storage, otherTabB, proposalA!.proposalId, now + 3000);
  assert.equal(clearByNonOwner, false);
  assert.notEqual(getActivationProposal(storage, now + 3000), null);

  // 6. Owner aborts proposal -> cleans up storage
  const abortByOwner = abortActivationProposal(proposalA!.proposalId, ownerTabA, storage, now + 4000);
  assert.equal(abortByOwner, true);
  assert.equal(getActivationProposal(storage, now + 4000), null);

  // 7. Owner crash & TTL expiry: if owner crashes without aborting, after TTL another tab can acquire fresh proposal
  const proposalBeforeCrash = createActivationProposal(
    {
      ownerTabId: ownerTabA,
      target: mockTargetV1,
      workerNonce: "nonce-w1",
      ttlMs: 5000,
    },
    storage,
    now + 5000
  );
  assert.notEqual(proposalBeforeCrash, null);

  // Still active at now + 8000
  assert.equal(
    createActivationProposal(
      { ownerTabId: otherTabC, target: mockTargetV2, workerNonce: "nonce-w2" },
      storage,
      now + 8000
    ),
    null
  );

  // Expired at now + 11000 -> Tab C can now create fresh proposal via CAS
  const proposalAfterExpiry = createActivationProposal(
    {
      ownerTabId: otherTabC,
      target: mockTargetV2,
      workerNonce: "nonce-w2",
      ttlMs: 10000,
    },
    storage,
    now + 11000
  );
  assert.notEqual(proposalAfterExpiry, null);
  assert.equal(proposalAfterExpiry?.ownerTabId, otherTabC);
  assert.equal(proposalAfterExpiry?.targetBuild, "build-target-2");
});

test("getOrCreateTabId - sessionStorage UUID helper", () => {
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
    type: "PWA_TAB_VOTE_ACK",
    requestNonce,
    proposalId,
    passId,
    voteNonce,
    targetBuild: "b-100",
    workerNonce: "w-nonce-1",
    status: "ACK_SAFE" as const,
  };
  assert.equal(isPwaTabVoteAckResponse(voteAck), true);
  assert.equal(isStrictPwaTabVoteAck(voteAck), true);

  const voteNack = {
    protocol: 1,
    type: "PWA_TAB_VOTE_NACK",
    requestNonce,
    proposalId,
    passId,
    voteNonce,
    targetBuild: "b-100",
    workerNonce: "w-nonce-1",
    status: "NACK_ACTIVE" as const,
    reason: "Conversation active",
  };
  assert.equal(isPwaTabVoteNackResponse(voteNack), true);
  assert.equal(isStrictPwaTabVoteNack(voteNack), true);
});

test("evaluateTabVote - Pure page vote evaluation with strict vote types", () => {
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

  // 1. Safe route & ready -> ACK_SAFE (PWA_TAB_VOTE_ACK)
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
  assert.equal(ack.type, "PWA_TAB_VOTE_ACK");
  assert.equal(ack.status, "ACK_SAFE");
  assert.equal(ack.passId, passId);
  assert.equal(ack.voteNonce, voteNonce);
  assert.equal(ack.targetBuild, "build-v2");
  assert.equal(ack.workerNonce, "nonce-w1");

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
  assert.equal(nackActive.type, "PWA_TAB_VOTE_NACK");
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

test("createActivationProposal - CAS write read-back failure returns null", () => {
  const flakyStorage: Storage = {
    length: 0,
    clear: () => {},
    getItem: () => "corrupted-or-concurrently-modified-json",
    key: () => null,
    removeItem: () => {},
    setItem: () => {},
  };

  const proposal = createActivationProposal(
    {
      ownerTabId: "11111111-2222-4333-8444-555555555555",
      target: mockTargetV1,
      workerNonce: "nonce-w1",
    },
    flakyStorage,
    100000
  );

  // CAS read-back fails because getItem returned invalid/mismatched data
  assert.equal(proposal, null);
});
