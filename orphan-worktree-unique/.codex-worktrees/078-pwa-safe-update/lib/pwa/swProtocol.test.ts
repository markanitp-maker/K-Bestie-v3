import test from "node:test";
import assert from "node:assert/strict";
import {
  SW_PROTOCOL_VERSION,
  hasOnlyAllowedKeys,
  isValidUuid,
  parseActivationProposal,
  isPwaGetIdentityRequest,
  isPwaIdentityResponse,
  isPwaPrepareActivationRequest,
  isPwaTabPrepareRequest,
  isPwaTabVoteAckResponse,
  isPwaTabVoteNackResponse,
  isPwaActivationAbortedNotice,
  isPwaActivationCommittedNotice,
  isValidStaleAssetPath,
  validateStaleAssetEnvelope,
  requestServiceWorkerIdentity,
  ActivationProposal,
} from "./swProtocol";

test("hasOnlyAllowedKeys & isValidUuid", () => {
  assert.equal(hasOnlyAllowedKeys({ a: 1, b: 2 }, ["a", "b"]), true);
  assert.equal(hasOnlyAllowedKeys({ a: 1, b: 2, c: 3 }, ["a", "b"]), false);

  const validUuid = "12345678-1234-4234-8234-123456789abc";
  assert.equal(isValidUuid(validUuid), true);
  assert.equal(isValidUuid("invalid-uuid"), false);
  assert.equal(isValidUuid(""), false);
});

test("parseActivationProposal - strict schema, unknown keys & expiration", () => {
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

  // Unknown key rejection
  assert.equal(
    parseActivationProposal({ ...validProposal, unknownKey: "hacked" }, now),
    null
  );

  // Expired proposal rejection
  assert.equal(parseActivationProposal(validProposal, now + 30000), null);

  // Invalid protocol rejection
  assert.equal(parseActivationProposal({ ...validProposal, protocol: 2 }, now), null);

  // Invalid workerNonce / targetBuild rejection
  assert.equal(parseActivationProposal({ ...validProposal, workerNonce: "" }, now), null);
  assert.equal(parseActivationProposal({ ...validProposal, targetBuild: "   " }, now), null);
});

test("Message envelopes & type guards with unknown key rejection", () => {
  const requestNonce = "req-12345";
  const proposalId = "12345678-1234-4234-8234-123456789abc";
  const ownerTabId = "87654321-4321-4321-8321-cba987654321";
  const passId = "abcdef01-2345-6789-abcd-ef0123456789";
  const voteNonce = "98765432-10fe-dcba-9876-543210fedcba";

  // 1. PWA_GET_IDENTITY
  const getIdentity = { protocol: 1, type: "PWA_GET_IDENTITY", requestNonce };
  assert.equal(isPwaGetIdentityRequest(getIdentity), true);
  assert.equal(isPwaGetIdentityRequest({ ...getIdentity, extra: "bad" }), false);

  // 2. PWA_IDENTITY_RESPONSE
  const identityRes = {
    protocol: 1,
    type: "PWA_IDENTITY_RESPONSE",
    requestNonce,
    buildId: "build-100",
    swVersion: "kbestie-shell-build-100",
    workerNonce: "nonce-100",
  };
  assert.equal(isPwaIdentityResponse(identityRes, requestNonce), true);
  assert.equal(isPwaIdentityResponse({ ...identityRes, unexpectedKey: 1 }), false);

  // 3. PWA_PREPARE_ACTIVATION
  const proposal: ActivationProposal = {
    protocol: 1,
    proposalId,
    ownerTabId,
    targetBuild: "build-100",
    workerNonce: "nonce-100",
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };
  const prepReq = { protocol: 1, type: "PWA_PREPARE_ACTIVATION", requestNonce, proposal };
  assert.equal(isPwaPrepareActivationRequest(prepReq), true);
  assert.equal(isPwaPrepareActivationRequest({ ...prepReq, hacked: true }), false);

  // 4. PWA_TAB_PREPARE
  const tabPrepReq = {
    protocol: 1,
    type: "PWA_TAB_PREPARE",
    requestNonce,
    proposal,
    passId,
    voteNonce,
    targetBuild: "build-100",
    targetSwVersion: "kbestie-shell-build-100",
    workerNonce: "nonce-100",
    expiresAt: proposal.expiresAt,
  };
  assert.equal(isPwaTabPrepareRequest(tabPrepReq), true);
  assert.equal(isPwaTabPrepareRequest({ ...tabPrepReq, clientId: "should-not-be-here" }), false);

  // 5. PWA_TAB_ACK & PWA_TAB_NACK
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
  assert.equal(isPwaTabVoteAckResponse({ ...voteAck, clientId: "should-not-be-here" }), false);

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
  assert.equal(isPwaTabVoteNackResponse({ ...voteNack, extraField: "bad" }), false);

  // 6. Notices
  const abortedNotice = {
    protocol: 1,
    type: "PWA_ACTIVATION_ABORTED",
    requestNonce,
    proposalId,
    reason: "Timeout",
  };
  assert.equal(isPwaActivationAbortedNotice(abortedNotice), true);
  assert.equal(isPwaActivationAbortedNotice({ ...abortedNotice, extra: 1 }), false);

  const committedNotice = {
    protocol: 1,
    type: "PWA_ACTIVATION_COMMITTED",
    requestNonce,
    proposalId,
    workerNonce: "nonce-100",
  };
  assert.equal(isPwaActivationCommittedNotice(committedNotice), true);
  assert.equal(isPwaActivationCommittedNotice({ ...committedNotice, workerNonce: "" }), false);
});

test("Stale asset envelope validation & unknown keys", () => {
  const staleEnv = {
    protocol: 1,
    type: "K_STALE_ASSET",
    requestNonce: "req-stale-1",
    buildId: "build-1",
    workerNonce: "nonce-1",
    pathname: "/_next/static/chunks/main.js",
    status: 404,
  };

  assert.deepEqual(validateStaleAssetEnvelope(staleEnv), staleEnv);
  assert.equal(validateStaleAssetEnvelope({ ...staleEnv, unknownKey: "bad" }), null);
  assert.equal(validateStaleAssetEnvelope({ ...staleEnv, pathname: "/offline" }), null);
});

test("requestServiceWorkerIdentity - v1 MessageChannel vs v0 legacy fallback", async () => {
  // Mock MessageChannel for test
  class MockPort {
    onmessage: ((ev: any) => void) | null = null;
    otherPort: MockPort | null = null;

    postMessage(msg: any) {
      if (this.otherPort && this.otherPort.onmessage) {
        setTimeout(() => {
          if (this.otherPort?.onmessage) {
            this.otherPort.onmessage({ data: msg });
          }
        }, 5);
      }
    }

    close() {}
  }

  const originalMessageChannel = (globalThis as any).MessageChannel;
  (globalThis as any).MessageChannel = class {
    port1 = new MockPort();
    port2 = new MockPort();
    constructor() {
      this.port1.otherPort = this.port2;
      this.port2.otherPort = this.port1;
    }
  };

  try {
    // 1. Worker supporting protocol v1 identity
    const mockV1Worker: any = {
      postMessage(msg: any, ports: any[]) {
        if (msg.protocol === 1 && msg.type === "PWA_GET_IDENTITY" && ports && ports[0]) {
          ports[0].postMessage({
            protocol: 1,
            type: "PWA_IDENTITY_RESPONSE",
            requestNonce: msg.requestNonce,
            buildId: "build-v1-test",
            swVersion: "kbestie-shell-build-v1-test",
            workerNonce: "nonce-v1-test",
          });
        }
      },
    };

    const identityV1 = await requestServiceWorkerIdentity(mockV1Worker, 500);
    assert.notEqual(identityV1, null);
    assert.equal(identityV1?.protocolVersion, 1);
    assert.equal(identityV1?.buildId, "build-v1-test");
    assert.equal(identityV1?.workerNonce, "nonce-v1-test");

    // 2. Legacy worker supporting only GET_VERSION (v0)
    const mockV0Worker: any = {
      postMessage(msg: any, ports: any[]) {
        if (msg.type === "GET_VERSION" && ports && ports[0]) {
          ports[0].postMessage({
            protocol: 0,
            type: "VERSION_RESPONSE",
            version: "legacy-v0-build",
            buildId: "legacy-v0-build",
            swVersion: "legacy-v0-build",
            workerNonce: null,
          });
        }
      },
    };

    const identityV0 = await requestServiceWorkerIdentity(mockV0Worker, 100);
    assert.notEqual(identityV0, null);
    assert.equal(identityV0?.protocolVersion, 0);
    assert.equal(identityV0?.buildId, "legacy-v0-build");
    assert.equal(identityV0?.workerNonce, null);
  } finally {
    (globalThis as any).MessageChannel = originalMessageChannel;
  }
});
