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
  isStrictPwaTabVoteAck,
  isStrictPwaTabVoteNack,
  isLegacyTabVote,
  isPwaActivationAbortedNotice,
  isPwaActivationCommittedNotice,
  isValidStaleAssetPath,
  validateStaleAssetEnvelope,
  requestServiceWorkerIdentity,
  requestActivationViaChannel,
  waitForControllerIdentity,
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

  // 4. PWA_TAB_PREPARE (must NOT carry clientId)
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

  // 5. PWA_TAB_VOTE_ACK & PWA_TAB_VOTE_NACK (must NOT carry clientId, requires all target/worker fields)
  const voteAck = {
    protocol: 1,
    type: "PWA_TAB_VOTE_ACK",
    requestNonce,
    proposalId,
    passId,
    voteNonce,
    targetBuild: "build-100",
    workerNonce: "nonce-100",
    status: "ACK_SAFE",
  };
  assert.equal(isPwaTabVoteAckResponse(voteAck), true);
  assert.equal(isStrictPwaTabVoteAck(voteAck), true);
  assert.equal(isPwaTabVoteAckResponse({ ...voteAck, clientId: "should-not-be-here" }), false);
  assert.equal(isStrictPwaTabVoteAck({ ...voteAck, type: "PWA_TAB_ACK" }), false); // legacy alias rejected by strict guard
  assert.equal(isLegacyTabVote({ protocol: 1, type: "PWA_TAB_ACK" }), true);
  assert.equal(isLegacyTabVote(voteAck), false);

  const voteNack = {
    protocol: 1,
    type: "PWA_TAB_VOTE_NACK",
    requestNonce,
    proposalId,
    passId,
    voteNonce,
    targetBuild: "build-100",
    workerNonce: "nonce-100",
    status: "NACK_ACTIVE",
    reason: "Conversation active",
  };
  assert.equal(isPwaTabVoteNackResponse(voteNack), true);
  assert.equal(isStrictPwaTabVoteNack(voteNack), true);
  assert.equal(isPwaTabVoteNackResponse({ ...voteNack, extraField: "bad" }), false);
  assert.equal(isStrictPwaTabVoteNack({ ...voteNack, type: "PWA_TAB_NACK" }), false); // legacy alias rejected by strict guard

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
  class MockPort {
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    otherPort: MockPort | null = null;

    postMessage(msg: unknown) {
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

  const globalObj = globalThis as unknown as { MessageChannel?: unknown };
  const originalMessageChannel = globalObj.MessageChannel;
  globalObj.MessageChannel = class {
    port1 = new MockPort();
    port2 = new MockPort();
    constructor() {
      this.port1.otherPort = this.port2;
      this.port2.otherPort = this.port1;
    }
  };

  try {
    // 1. Worker supporting protocol v1 identity
    const mockV1Worker = {
      postMessage(msgValue: unknown, transfers?: Transferable[]) {
        const msg = msgValue as Record<string, unknown>;
        const ports = transfers as unknown as MessagePort[] | undefined;
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
    } as unknown as ServiceWorker;

    const identityV1 = await requestServiceWorkerIdentity(mockV1Worker, 500);
    assert.notEqual(identityV1, null);
    assert.equal(identityV1?.protocolVersion, 1);
    assert.equal(identityV1?.buildId, "build-v1-test");
    assert.equal(identityV1?.workerNonce, "nonce-v1-test");

    // 2. Legacy worker supporting only GET_VERSION (v0)
    const mockV0Worker = {
      postMessage(msgValue: unknown, transfers?: Transferable[]) {
        const msg = msgValue as Record<string, unknown>;
        const ports = transfers as unknown as MessagePort[] | undefined;
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
    } as unknown as ServiceWorker;

    const identityV0 = await requestServiceWorkerIdentity(mockV0Worker, 100);
    assert.notEqual(identityV0, null);
    assert.equal(identityV0?.protocolVersion, 0);
    assert.equal(identityV0?.buildId, "legacy-v0-build");
    assert.equal(identityV0?.workerNonce, null);
  } finally {
    globalObj.MessageChannel = originalMessageChannel;
  }
});

test("requestServiceWorkerIdentity - abort closes the active channel and skips legacy fallback", async () => {
  let closedPortCount = 0;
  const postedTypes: string[] = [];

  class MockPort {
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    otherPort: MockPort | null = null;

    postMessage() {}

    close() {
      closedPortCount += 1;
    }
  }

  const globalObj = globalThis as unknown as { MessageChannel?: unknown };
  const originalMessageChannel = globalObj.MessageChannel;
  globalObj.MessageChannel = class {
    port1 = new MockPort();
    port2 = new MockPort();
    constructor() {
      this.port1.otherPort = this.port2;
      this.port2.otherPort = this.port1;
    }
  };

  const unresponsiveWorker = {
    postMessage(messageValue: unknown) {
      const message = messageValue as Record<string, unknown>;
      if (typeof message.type === "string") postedTypes.push(message.type);
    },
  } as unknown as ServiceWorker;
  const abortController = new AbortController();

  try {
    const startedAt = Date.now();
    const identityPromise = requestServiceWorkerIdentity(
      unresponsiveWorker,
      5000,
      abortController.signal
    );
    abortController.abort();

    const identity = await identityPromise;
    assert.equal(identity, null);
    assert.ok(Date.now() - startedAt < 500);
    assert.deepEqual(postedTypes, ["PWA_GET_IDENTITY"]);
    assert.equal(closedPortCount, 1);

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(postedTypes, ["PWA_GET_IDENTITY"]);
    assert.equal(closedPortCount, 1);
  } finally {
    globalObj.MessageChannel = originalMessageChannel;
  }
});

test("requestActivationViaChannel - private MessageChannel activation handshake", async () => {
  class MockPort {
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    otherPort: MockPort | null = null;

    postMessage(msg: unknown) {
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

  const globalObj = globalThis as unknown as { MessageChannel?: unknown };
  const originalMessageChannel = globalObj.MessageChannel;
  globalObj.MessageChannel = class {
    port1 = new MockPort();
    port2 = new MockPort();
    constructor() {
      this.port1.otherPort = this.port2;
      this.port2.otherPort = this.port1;
    }
  };

  const proposal: ActivationProposal = {
    protocol: 1,
    proposalId: "12345678-1234-4234-8234-123456789abc",
    ownerTabId: "87654321-4321-4321-8321-cba987654321",
    targetBuild: "build-target-1",
    workerNonce: "nonce-1",
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  try {
    // 1. Success case: worker replies with PWA_ACTIVATION_COMMITTED
    const mockSuccessWorker = {
      postMessage(msgValue: unknown, transfers?: Transferable[]) {
        const msg = msgValue as Record<string, unknown>;
        const ports = transfers as unknown as MessagePort[] | undefined;
        if (msg.protocol === 1 && msg.type === "PWA_PREPARE_ACTIVATION" && ports && ports[0]) {
          ports[0].postMessage({
            protocol: 1,
            type: "PWA_ACTIVATION_COMMITTED",
            requestNonce: msg.requestNonce,
            proposalId: (msg.proposal as ActivationProposal).proposalId,
            workerNonce: "nonce-1",
          });
        }
      },
    } as unknown as ServiceWorker;

    const successResult = await requestActivationViaChannel(mockSuccessWorker, proposal, 500);
    assert.equal(successResult.ok, true);
    assert.equal(successResult.workerNonce, "nonce-1");

    // 2. Abort case: worker replies with PWA_ACTIVATION_ABORTED
    const mockAbortWorker = {
      postMessage(msgValue: unknown, transfers?: Transferable[]) {
        const msg = msgValue as Record<string, unknown>;
        const ports = transfers as unknown as MessagePort[] | undefined;
        if (msg.protocol === 1 && msg.type === "PWA_PREPARE_ACTIVATION" && ports && ports[0]) {
          ports[0].postMessage({
            protocol: 1,
            type: "PWA_ACTIVATION_ABORTED",
            requestNonce: msg.requestNonce,
            proposalId: (msg.proposal as ActivationProposal).proposalId,
            reason: "NACK_ACTIVE from tab",
          });
        }
      },
    } as unknown as ServiceWorker;

    const abortResult = await requestActivationViaChannel(mockAbortWorker, proposal, 500);
    assert.equal(abortResult.ok, false);
    assert.equal(abortResult.reason, "NACK_ACTIVE from tab");
  } finally {
    globalObj.MessageChannel = originalMessageChannel;
  }
});

test("waitForControllerIdentity - resolves when initial null controller becomes ready with matching identity", async () => {
  const listeners: Record<string, ((ev: Event) => void)[]> = {};
  const mockContainer = {
    controller: null as ServiceWorker | null,
    addEventListener(type: string, listener: (ev: Event) => void) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener(type: string, listener: (ev: Event) => void) {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((l) => l !== listener);
      }
    },
  };

  const mockWorker = {
    postMessage(messageValue: unknown, transfers?: Transferable[]) {
      const message = messageValue as Record<string, unknown>;
      const port = transfers?.[0] as MessagePort | undefined;
      if (
        message?.protocol === 1 &&
        message?.type === "PWA_GET_IDENTITY" &&
        port &&
        typeof port.postMessage === "function"
      ) {
        port.postMessage({
          protocol: 1,
          type: "PWA_IDENTITY_RESPONSE",
          requestNonce: message.requestNonce,
          buildId: "build-target-v1",
          swVersion: "sw-target-v1",
          workerNonce: "nonce-resolved-controller",
        });
      }
    },
  } as unknown as ServiceWorker;

  setTimeout(() => {
    mockContainer.controller = mockWorker;
    for (const listener of listeners["controllerchange"] || []) {
      listener(new Event("controllerchange"));
    }
  }, 20);

  const res = await waitForControllerIdentity({
    expectedBuildId: "build-target-v1",
    expectedSwVersion: "sw-target-v1",
    timeoutMs: 500,
    swContainer: mockContainer,
  });

  assert.equal(res.controller, mockWorker);
  assert.notEqual(res.identity, null);
  assert.equal(res.identity?.buildId, "build-target-v1");
  assert.equal(res.identity?.workerNonce, "nonce-resolved-controller");
});

test("waitForControllerIdentity - bounded wait returns mismatched identity without infinite wait", async () => {
  const listeners: Record<string, ((ev: Event) => void)[]> = {};
  const mockWorkerOld = {
    postMessage(messageValue: unknown, transfers?: Transferable[]) {
      const message = messageValue as Record<string, unknown>;
      const port = transfers?.[0] as MessagePort | undefined;
      if (
        message?.protocol === 1 &&
        message?.type === "PWA_GET_IDENTITY" &&
        port &&
        typeof port.postMessage === "function"
      ) {
        port.postMessage({
          protocol: 1,
          type: "PWA_IDENTITY_RESPONSE",
          requestNonce: message.requestNonce,
          buildId: "build-old",
          swVersion: "sw-old",
          workerNonce: "nonce-old",
        });
      }
    },
  } as unknown as ServiceWorker;

  const mockContainer = {
    controller: mockWorkerOld,
    addEventListener(type: string, listener: (ev: Event) => void) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener(type: string, listener: (ev: Event) => void) {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((l) => l !== listener);
      }
    },
  };

  const res = await waitForControllerIdentity({
    expectedBuildId: "build-new",
    expectedSwVersion: "sw-new",
    timeoutMs: 150,
    swContainer: mockContainer,
  });

  assert.equal(res.controller, mockWorkerOld);
  assert.equal(res.identity?.buildId, "build-old");
});

test("waitForControllerIdentity - returns null controller when timeout expires on null controller", async () => {
  const mockContainer = {
    controller: null,
    addEventListener() {},
    removeEventListener() {},
  };

  const res = await waitForControllerIdentity({
    expectedBuildId: "build-new",
    expectedSwVersion: "sw-new",
    timeoutMs: 100,
    swContainer: mockContainer,
  });

  assert.equal(res.controller, null);
  assert.equal(res.identity, null);
});

test("waitForControllerIdentity - controller replacement during wait discards stale identity and resolves with new controller", async () => {
  const listeners: Record<string, ((ev: Event) => void)[]> = {};

  const mockWorkerOld = {
    postMessage(messageValue: unknown, transfers?: Transferable[]) {
      const message = messageValue as Record<string, unknown>;
      const port = transfers?.[0] as MessagePort | undefined;
      if (
        message?.protocol === 1 &&
        message?.type === "PWA_GET_IDENTITY" &&
        port &&
        typeof port.postMessage === "function"
      ) {
        port.postMessage({
          protocol: 1,
          type: "PWA_IDENTITY_RESPONSE",
          requestNonce: message.requestNonce,
          buildId: "build-old",
          swVersion: "sw-old",
          workerNonce: "nonce-old",
        });
      }
    },
  } as unknown as ServiceWorker;

  const mockWorkerNew = {
    postMessage(messageValue: unknown, transfers?: Transferable[]) {
      const message = messageValue as Record<string, unknown>;
      const port = transfers?.[0] as MessagePort | undefined;
      if (
        message?.protocol === 1 &&
        message?.type === "PWA_GET_IDENTITY" &&
        port &&
        typeof port.postMessage === "function"
      ) {
        port.postMessage({
          protocol: 1,
          type: "PWA_IDENTITY_RESPONSE",
          requestNonce: message.requestNonce,
          buildId: "build-new",
          swVersion: "sw-new",
          workerNonce: "nonce-new",
        });
      }
    },
  } as unknown as ServiceWorker;

  const mockContainer = {
    controller: mockWorkerOld,
    addEventListener(type: string, listener: (ev: Event) => void) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener(type: string, listener: (ev: Event) => void) {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((l) => l !== listener);
      }
    },
  };

  // Controller is replaced after 20ms
  setTimeout(() => {
    mockContainer.controller = mockWorkerNew;
    for (const listener of listeners["controllerchange"] || []) {
      listener(new Event("controllerchange"));
    }
  }, 20);

  const res = await waitForControllerIdentity({
    expectedBuildId: "build-new",
    expectedSwVersion: "sw-new",
    timeoutMs: 500,
    swContainer: mockContainer,
  });

  assert.equal(res.controller, mockWorkerNew);
  assert.notEqual(res.identity, null);
  assert.equal(res.identity?.buildId, "build-new");
  assert.equal(res.identity?.workerNonce, "nonce-new");
});

test("waitForControllerIdentity - controller replacement right before timeout never combines new controller with old identity", async () => {
  const listeners: Record<string, ((ev: Event) => void)[]> = {};

  const mockWorkerOld = {
    postMessage(messageValue: unknown, transfers?: Transferable[]) {
      const message = messageValue as Record<string, unknown>;
      const port = transfers?.[0] as MessagePort | undefined;
      if (
        message?.protocol === 1 &&
        message?.type === "PWA_GET_IDENTITY" &&
        port &&
        typeof port.postMessage === "function"
      ) {
        port.postMessage({
          protocol: 1,
          type: "PWA_IDENTITY_RESPONSE",
          requestNonce: message.requestNonce,
          buildId: "build-old",
          swVersion: "sw-old",
          workerNonce: "nonce-old",
        });
      }
    },
  } as unknown as ServiceWorker;

  const mockWorkerUnresponsive = {
    postMessage() {
      // Never responds
    },
  } as unknown as ServiceWorker;

  const mockContainer = {
    controller: mockWorkerOld,
    addEventListener(type: string, listener: (ev: Event) => void) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener(type: string, listener: (ev: Event) => void) {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((l) => l !== listener);
      }
    },
  };

  // Controller changes to unresponsive worker at 25ms
  setTimeout(() => {
    mockContainer.controller = mockWorkerUnresponsive;
    for (const listener of listeners["controllerchange"] || []) {
      listener(new Event("controllerchange"));
    }
  }, 25);

  const res = await waitForControllerIdentity({
    expectedBuildId: "build-new",
    expectedSwVersion: "sw-new",
    timeoutMs: 100,
    swContainer: mockContainer,
  });

  // Must have new controller, but identity MUST BE null (never combined with build-old identity!)
  assert.equal(res.controller, mockWorkerUnresponsive);
  assert.equal(res.identity, null);
});

test("waitForControllerIdentity - AbortSignal abort immediately settles with null", async () => {
  const abortController = new AbortController();
  const mockContainer = {
    controller: null,
    addEventListener() {},
    removeEventListener() {},
  };

  setTimeout(() => {
    abortController.abort();
  }, 20);

  const res = await waitForControllerIdentity({
    expectedBuildId: "build-new",
    timeoutMs: 5000,
    swContainer: mockContainer,
    signal: abortController.signal,
  });

  assert.equal(res.controller, null);
  assert.equal(res.identity, null);
});
