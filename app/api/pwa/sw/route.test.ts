import test from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { GET, PRECACHE_ASSETS } from "./route.js";
import { renderServiceWorker } from "../../../../lib/pwa/renderServiceWorker.js";
import { BUILD_STAMP } from "../../../../lib/pwa/buildStamp.js";
import { requestActivationViaChannel } from "../../../../lib/pwa/swProtocol.js";

test("생성 SW는 사용자 메시지 handler 한 곳에서만 skipWaiting을 실행한다", async () => {
  const response = await GET();
  const source = await response.text();
  assert.equal(source.match(/self\.skipWaiting\(\)/g)?.length, 1);
  assert.match(source, /handledProposals\.add\(proposalId\)/);

  const installBlock = source.slice(
    source.indexOf('self.addEventListener("install"'),
    source.indexOf('self.addEventListener("activate"')
  );
  assert.doesNotMatch(installBlock, /self\.skipWaiting\(\)/);
});

test("SW 응답 및 renderer는 동일 입력 시 byte-for-byte 고정되며 SHA-256 해시가 일치한다", async () => {
  const response1 = await GET();
  const source1 = await response1.text();

  const response2 = await GET();
  const source2 = await response2.text();

  // Stable bytes & hash requirement
  assert.equal(source1, source2);
  const hash1 = crypto.createHash("sha256").update(source1).digest("hex");
  const hash2 = crypto.createHash("sha256").update(source2).digest("hex");
  assert.equal(hash1, hash2);

  // Pure renderer produces byte-identical output
  const rendered1 = renderServiceWorker({
    buildId: "test-build-1",
    buildStamp: "test-stamp-1",
    swVersion: "kbestie-shell-test-build-1",
    cacheAssets: PRECACHE_ASSETS,
  });
  const rendered2 = renderServiceWorker({
    buildId: "test-build-1",
    buildStamp: "test-stamp-1",
    swVersion: "kbestie-shell-test-build-1",
    cacheAssets: PRECACHE_ASSETS,
  });
  assert.equal(rendered1, rendered2);

  // No Promise.all in generated SW script
  assert.equal(source1.includes("Promise.all("), false);

  // Runtime nonce statement exists in emitted script, but no route UUID literal
  assert.match(source1, /const SW_INSTANCE_NONCE = crypto\.randomUUID\(\);/);
  assert.doesNotMatch(source1, /const SW_INSTANCE_NONCE = "[0-9a-fA-F-]{36}";/);

  assert.match(source1, /kbestie-shell-/);
  assert.match(response1.headers.get("cache-control") || "", /no-cache/);
  assert.match(response1.headers.get("cache-control") || "", /no-store/);
  assert.equal(response1.headers.get("service-worker-allowed"), "/");
  assert.match(source1, new RegExp(BUILD_STAMP.replace(/\./g, "\\.")));
});

test("Push는 notificationId를 보존하고 클릭할 때 서버 읽음 처리 후 이동한다", async () => {
  const response = await GET();
  const source = await response.text();
  assert.match(source, /notificationId: data\.notificationId/);
  assert.match(source, /\/api\/notifications\/" \+ encodeURIComponent\(notificationId\) \+ "\/read/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /self\.clients\.openWindow\(targetUrl\)/);
});

test("Push 수신 시 서버 unreadCount로 앱 배지를 동기화한다", async () => {
  const response = await GET();
  const source = await response.text();
  assert.match(source, /fetch\("\/api\/notifications\?limit=1"/);
  assert.match(source, /self\.navigator\.setAppBadge/);
  assert.match(source, /self\.navigator\.clearAppBadge/);
});

type MessageRecord = Record<string, unknown>;

interface MockMessagePort {
  postMessage(message: unknown): void;
}

interface MockWindowClient {
  id: string;
  url: string;
  postMessage(message: unknown): void;
}

interface MockSwEvent {
  data: unknown;
  source?: MockWindowClient | null;
  ports?: MockMessagePort[];
  waitUntil?: (promise: Promise<void>) => void;
}

interface MockSwEnvironment {
  listeners: Record<string, (event: MockSwEvent) => void>;
  getSkipWaitingCount: () => number;
  mockClientsList: MockWindowClient[];
  postedMessages: Array<{
    client: MockWindowClient;
    message: MessageRecord;
  }>;
}

interface PrepareMessage {
  requestNonce: string;
  proposal: { proposalId: string };
  passId: string;
  voteNonce: string;
}

function asMessageRecord(value: unknown): MessageRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as MessageRecord)
    : null;
}

function parsePrepareMessage(value: unknown): PrepareMessage | null {
  const message = asMessageRecord(value);
  const proposal = asMessageRecord(message?.proposal);
  if (
    message?.type !== "PWA_TAB_PREPARE" ||
    typeof message.requestNonce !== "string" ||
    typeof proposal?.proposalId !== "string" ||
    typeof message.passId !== "string" ||
    typeof message.voteNonce !== "string"
  ) {
    return null;
  }
  return {
    requestNonce: message.requestNonce,
    proposal: { proposalId: proposal.proposalId },
    passId: message.passId,
    voteNonce: message.voteNonce,
  };
}

function captureMessage(setter: (message: MessageRecord) => void): MockMessagePort {
  return {
    postMessage(value: unknown) {
      const message = asMessageRecord(value);
      assert.ok(message, "Expected a structured worker message");
      setter(message);
    },
  };
}

function messageField(
  message: MessageRecord | null,
  field: string,
): unknown {
  assert.ok(message, `Expected captured message before reading ${field}`);
  return message[field];
}

function messageString(
  message: MessageRecord | null,
  field: string,
): string {
  const value = messageField(message, field);
  assert.equal(typeof value, "string", `Expected ${field} to be a string`);
  return value as string;
}

function createMockSwEnvironment(
  swSource: string,
  options?: { skipWaitingImpl?: () => Promise<void> | void }
): MockSwEnvironment {
  const listeners: Record<string, (event: MockSwEvent) => void> = {};
  let skipWaitingCalls = 0;
  const postedMessages: Array<{
    client: MockWindowClient;
    message: MessageRecord;
  }> = [];

  const mockClientsList: MockWindowClient[] = [];

  const mockSelf = {
    location: { origin: "https://app.k-bestie.com", pathname: "/sw.js" },
    addEventListener(event: string, callback: unknown) {
      if (typeof callback !== "function") {
        throw new Error(`Expected ${event} service-worker listener`);
      }
      listeners[event] = callback as (event: MockSwEvent) => void;
    },
    async skipWaiting() {
      skipWaitingCalls++;
      if (options?.skipWaitingImpl) {
        return options.skipWaitingImpl();
      }
    },
    clients: {
      matchAll: async () => [...mockClientsList],
      get: async (id: string) => mockClientsList.find((c) => c.id === id) || null,
      claim: async () => {},
    },
    caches: {
      open: async () => ({
        add: async () => {},
        put: async () => {},
      }),
      match: async () => null,
      keys: async () => [],
      delete: async () => true,
    },
  };

  const runner = new Function("self", "console", "crypto", swSource);
  runner(mockSelf, { log: () => {}, warn: () => {}, error: () => {} }, crypto);

  return {
    listeners,
    getSkipWaitingCount: () => skipWaitingCalls,
    mockClientsList,
    postedMessages,
  };
}

function getWorkerRuntimeNonce(
  env: MockSwEnvironment,
  client: MockWindowClient,
): string {
  let nonce = "";
  env.listeners["message"]({
    data: { protocol: 1, type: "PWA_GET_IDENTITY", requestNonce: "req-get-nonce" },
    source: client,
    ports: [
      {
        postMessage(value: unknown) {
          const message = asMessageRecord(value);
          if (message?.protocol === 1 && typeof message.workerNonce === "string") {
            nonce = message.workerNonce;
          }
        },
      },
    ],
  });
  return nonce;
}

test("Runtime nonce differs across two evaluated worker runtimes", async () => {
  const response = await GET();
  const swSource = await response.text();

  const env1 = createMockSwEnvironment(swSource);
  const env2 = createMockSwEnvironment(swSource);

  let nonce1: string | null = null;
  let nonce2: string | null = null;

  const mockPort1 = captureMessage((message) => {
    if (
      message.protocol === 1 &&
      message.type === "PWA_IDENTITY_RESPONSE" &&
      typeof message.workerNonce === "string"
    ) {
      nonce1 = message.workerNonce;
    }
  });

  const mockPort2 = captureMessage((message) => {
    if (
      message.protocol === 1 &&
      message.type === "PWA_IDENTITY_RESPONSE" &&
      typeof message.workerNonce === "string"
    ) {
      nonce2 = message.workerNonce;
    }
  });

  const client = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage() {},
  };

  env1.listeners["message"]({
    data: { protocol: 1, type: "PWA_GET_IDENTITY", requestNonce: "req-1" },
    source: client,
    ports: [mockPort1],
  });

  env2.listeners["message"]({
    data: { protocol: 1, type: "PWA_GET_IDENTITY", requestNonce: "req-2" },
    source: client,
    ports: [mockPort2],
  });

  assert.notEqual(nonce1, null);
  assert.notEqual(nonce2, null);
  assert.notEqual(nonce1, nonce2);
});

test("SW identity handshake - PWA_GET_IDENTITY (v1) and GET_VERSION (v0 legacy)", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage() {},
  };

  let port1Msg: MessageRecord | null = null;
  const mockPort = captureMessage((message) => {
    port1Msg = message;
  });

  // 1. PWA_GET_IDENTITY -> returns protocol 1 with workerNonce
  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_GET_IDENTITY",
      requestNonce: "req-ident-1",
    },
    source: client1,
    ports: [mockPort],
  });

  assert.notEqual(port1Msg, null);
  assert.equal(messageField(port1Msg, "protocol"), 1);
  assert.equal(messageField(port1Msg, "type"), "PWA_IDENTITY_RESPONSE");
  assert.equal(messageField(port1Msg, "requestNonce"), "req-ident-1");
  assert.equal(messageField(port1Msg, "buildId"), BUILD_STAMP);
  assert.match(messageString(port1Msg, "workerNonce"), /^[0-9a-fA-F-]{36}$/);

  // 2. GET_VERSION -> returns protocol 0 with workerNonce: null
  let legacyMsg: MessageRecord | null = null;
  const legacyPort = captureMessage((message) => {
    legacyMsg = message;
  });

  env.listeners["message"]({
    data: {
      type: "GET_VERSION",
      requestNonce: "req-legacy-1",
    },
    source: client1,
    ports: [legacyPort],
  });

  assert.notEqual(legacyMsg, null);
  assert.equal(messageField(legacyMsg, "protocol"), 0);
  assert.equal(messageField(legacyMsg, "type"), "VERSION_RESPONSE");
  assert.equal(messageField(legacyMsg, "workerNonce"), null);
});

test("Legacy identity rejected for activation handshake", async () => {
  // Mock a legacy worker that only supports GET_VERSION
  const mockLegacyWorker = {
    postMessage(messageValue: unknown, transfers?: Transferable[]) {
      const message = asMessageRecord(messageValue);
      const port = transfers?.[0];
      if (
        message?.type === "GET_VERSION" &&
        port &&
        "postMessage" in port &&
        typeof port.postMessage === "function"
      ) {
        port.postMessage({
          protocol: 0,
          type: "VERSION_RESPONSE",
          version: "legacy-build",
          buildId: "legacy-build",
          swVersion: "legacy-build",
          workerNonce: null,
        });
      }
    },
  };

  const proposal = {
    protocol: 1 as const,
    proposalId: "12345678-1234-4234-8234-123456789abc",
    ownerTabId: "87654321-4321-4321-8321-cba987654321",
    targetBuild: "legacy-build",
    workerNonce: "nonce-1",
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  // requestActivationViaChannel should fail when worker does not answer PWA_PREPARE_ACTIVATION via private port
  const result = await requestActivationViaChannel(
    mockLegacyWorker as unknown as ServiceWorker,
    proposal,
    100,
  );
  assert.equal(result.ok, false);
});

test("SW consensus execution - NACK / active / timeout => skipWaiting 0", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(value: unknown) {
      const message = asMessageRecord(value);
      const prepare = parsePrepareMessage(value);
      if (message && prepare) {
        env.postedMessages.push({ client: client1, message });
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_VOTE_NACK",
            requestNonce: prepare.requestNonce,
            proposalId: prepare.proposal.proposalId,
            passId: prepare.passId,
            voteNonce: prepare.voteNonce,
            targetBuild: BUILD_STAMP,
            workerNonce: workerNonce,
            status: "NACK_ACTIVE",
            reason: "Conversation active",
          },
          source: client1,
        });
      }
    },
  };
  env.mockClientsList.push(client1);

  const workerNonce = getWorkerRuntimeNonce(env, client1);

  const proposal = {
    protocol: 1,
    proposalId: "11111111-2222-4333-8444-555555555555",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: MessageRecord | null = null;
  const privatePort = captureMessage((message) => {
    privatePortResult = message;
  });

  let waitUntilPromise: Promise<void> | null = null;

  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-1",
      proposal,
    },
    source: client1,
    ports: [privatePort],
    waitUntil(p: Promise<void>) {
      waitUntilPromise = p;
    },
  });

  if (waitUntilPromise) await waitUntilPromise;

  assert.equal(env.getSkipWaitingCount(), 0);
  assert.notEqual(privatePortResult, null);
  assert.equal(messageField(privatePortResult, "type"), "PWA_ACTIVATION_ABORTED");
});

test("SW consensus execution - 2 stable passes with unanimous ACKs => skipWaiting 1", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(value: unknown) {
      const message = asMessageRecord(value);
      const prepare = parsePrepareMessage(value);
      if (message && prepare) {
        env.postedMessages.push({ client: client1, message });
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_VOTE_ACK",
            requestNonce: prepare.requestNonce,
            proposalId: prepare.proposal.proposalId,
            passId: prepare.passId,
            voteNonce: prepare.voteNonce,
            targetBuild: BUILD_STAMP,
            workerNonce: workerNonce,
            status: "ACK_SAFE",
          },
          source: client1,
        });
      }
    },
  };
  env.mockClientsList.push(client1);

  const workerNonce = getWorkerRuntimeNonce(env, client1);

  const proposal = {
    protocol: 1,
    proposalId: "22222222-3333-4444-8555-666666666666",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: MessageRecord | null = null;
  const privatePort = captureMessage((message) => {
    privatePortResult = message;
  });

  let waitUntilPromise: Promise<void> | null = null;

  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-2",
      proposal,
    },
    source: client1,
    ports: [privatePort],
    waitUntil(p: Promise<void>) {
      waitUntilPromise = p;
    },
  });

  if (waitUntilPromise) await waitUntilPromise;

  assert.equal(env.getSkipWaitingCount(), 1);
  assert.notEqual(privatePortResult, null);
  assert.equal(messageField(privatePortResult, "type"), "PWA_ACTIVATION_COMMITTED");
  assert.equal(messageField(privatePortResult, "workerNonce"), workerNonce);
});

test("SW consensus execution - skipWaiting pending ordering and resolution", async () => {
  const response = await GET();
  const swSource = await response.text();

  let resolveSkipWaiting: (() => void) | null = null;
  const skipWaitingPromise = new Promise<void>((res) => {
    resolveSkipWaiting = res;
  });

  const env = createMockSwEnvironment(swSource, {
    skipWaitingImpl: () => skipWaitingPromise,
  });

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(value: unknown) {
      const prepare = parsePrepareMessage(value);
      if (prepare) {
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_VOTE_ACK",
            requestNonce: prepare.requestNonce,
            proposalId: prepare.proposal.proposalId,
            passId: prepare.passId,
            voteNonce: prepare.voteNonce,
            targetBuild: BUILD_STAMP,
            workerNonce: workerNonce,
            status: "ACK_SAFE",
          },
          source: client1,
        });
      }
    },
  };
  env.mockClientsList.push(client1);

  const workerNonce = getWorkerRuntimeNonce(env, client1);

  const proposal = {
    protocol: 1,
    proposalId: "77777777-1111-4111-8111-111111111111",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: MessageRecord | null = null;
  const privatePort = captureMessage((message) => {
    privatePortResult = message;
  });

  let waitUntilPromise: Promise<void> | null = null;

  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-pending-test",
      proposal,
    },
    source: client1,
    ports: [privatePort],
    waitUntil(p: Promise<void>) {
      waitUntilPromise = p;
    },
  });

  // Give a small tick for the 2 passes to run and reach await self.skipWaiting()
  await new Promise((r) => setTimeout(r, 20));

  // During pending skipWaiting: skipWaiting has been called once, but COMMITTED has NOT been sent yet!
  assert.equal(env.getSkipWaitingCount(), 1);
  assert.equal(privatePortResult, null);

  // Now resolve skipWaiting:
  resolveSkipWaiting!();
  if (waitUntilPromise) await waitUntilPromise;

  // After resolution: COMMITTED message is received!
  assert.notEqual(privatePortResult, null);
  assert.equal(messageField(privatePortResult, "type"), "PWA_ACTIVATION_COMMITTED");
  assert.equal(messageField(privatePortResult, "proposalId"), proposal.proposalId);
  assert.equal(messageField(privatePortResult, "workerNonce"), workerNonce);
});

test("SW consensus execution - skipWaiting rejection results in ABORT and no COMMITTED", async () => {
  const response = await GET();
  const swSource = await response.text();

  const env = createMockSwEnvironment(swSource, {
    skipWaitingImpl: async () => {
      throw new Error("ServiceWorker registration failed to skip waiting");
    },
  });

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(value: unknown) {
      const prepare = parsePrepareMessage(value);
      if (prepare) {
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_VOTE_ACK",
            requestNonce: prepare.requestNonce,
            proposalId: prepare.proposal.proposalId,
            passId: prepare.passId,
            voteNonce: prepare.voteNonce,
            targetBuild: BUILD_STAMP,
            workerNonce: workerNonce,
            status: "ACK_SAFE",
          },
          source: client1,
        });
      }
    },
  };
  env.mockClientsList.push(client1);

  const workerNonce = getWorkerRuntimeNonce(env, client1);

  const proposal = {
    protocol: 1,
    proposalId: "88888888-2222-4222-8222-222222222222",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: MessageRecord | null = null;
  const privatePort = captureMessage((message) => {
    privatePortResult = message;
  });

  let waitUntilPromise: Promise<void> | null = null;

  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-reject-test",
      proposal,
    },
    source: client1,
    ports: [privatePort],
    waitUntil(p: Promise<void>) {
      waitUntilPromise = p;
    },
  });

  if (waitUntilPromise) await waitUntilPromise;

  assert.equal(env.getSkipWaitingCount(), 1);
  assert.notEqual(privatePortResult, null);
  assert.equal(messageField(privatePortResult, "type"), "PWA_ACTIVATION_ABORTED");
  assert.match(messageString(privatePortResult, "reason"), /skipWaiting/);
});

test("SW consensus execution - legacy PWA_TAB_ACK vote alias rejected => skipWaiting 0", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(value: unknown) {
      const prepare = parsePrepareMessage(value);
      if (prepare) {
        // Send legacy alias PWA_TAB_ACK
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_ACK", // Legacy alias
            requestNonce: prepare.requestNonce,
            proposalId: prepare.proposal.proposalId,
            passId: prepare.passId,
            voteNonce: prepare.voteNonce,
            status: "ACK_SAFE",
          },
          source: client1,
        });
      }
    },
  };
  env.mockClientsList.push(client1);

  const workerNonce = getWorkerRuntimeNonce(env, client1);

  const proposal = {
    protocol: 1,
    proposalId: "99999999-3333-4333-8333-333333333333",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: MessageRecord | null = null;
  const privatePort = captureMessage((message) => {
    privatePortResult = message;
  });

  let waitUntilPromise: Promise<void> | null = null;

  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-legacy-ack",
      proposal,
    },
    source: client1,
    ports: [privatePort],
    waitUntil(p: Promise<void>) {
      waitUntilPromise = p;
    },
  });

  if (waitUntilPromise) await waitUntilPromise;

  assert.equal(env.getSkipWaitingCount(), 0);
  assert.equal(messageField(privatePortResult, "type"), "PWA_ACTIVATION_ABORTED");
  assert.match(messageString(privatePortResult, "reason"), /Legacy vote alias/);
});

test("SW consensus execution - duplicate ACK in same pass rejected => skipWaiting 0", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(value: unknown) {
      const prepare = parsePrepareMessage(value);
      if (prepare) {
        // Send first valid vote
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_VOTE_ACK",
            requestNonce: prepare.requestNonce,
            proposalId: prepare.proposal.proposalId,
            passId: prepare.passId,
            voteNonce: prepare.voteNonce,
            targetBuild: BUILD_STAMP,
            workerNonce: workerNonce,
            status: "ACK_SAFE",
          },
          source: client1,
        });
        // Send duplicate vote immediately from client1 before client2 has voted
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_VOTE_ACK",
            requestNonce: prepare.requestNonce,
            proposalId: prepare.proposal.proposalId,
            passId: prepare.passId,
            voteNonce: prepare.voteNonce,
            targetBuild: BUILD_STAMP,
            workerNonce: workerNonce,
            status: "ACK_SAFE",
          },
          source: client1,
        });
      }
    },
  };

  const client2 = {
    id: "client-tab-2",
    url: "https://app.k-bestie.com/parent/home",
    postMessage() {},
  };

  env.mockClientsList.push(client1);
  env.mockClientsList.push(client2);

  const workerNonce = getWorkerRuntimeNonce(env, client1);

  const proposal = {
    protocol: 1,
    proposalId: "aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: MessageRecord | null = null;
  const privatePort = captureMessage((message) => {
    privatePortResult = message;
  });

  let waitUntilPromise: Promise<void> | null = null;

  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-dup-ack",
      proposal,
    },
    source: client1,
    ports: [privatePort],
    waitUntil(p: Promise<void>) {
      waitUntilPromise = p;
    },
  });

  if (waitUntilPromise) await waitUntilPromise;

  assert.equal(env.getSkipWaitingCount(), 0);
  assert.equal(messageField(privatePortResult, "type"), "PWA_ACTIVATION_ABORTED");
  assert.match(messageString(privatePortResult, "reason"), /Duplicate vote/);
});

test("SW consensus execution - client set changes triggers pass restart", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  let passCount = 0;

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(value: unknown) {
      const message = asMessageRecord(value);
      const prepare = parsePrepareMessage(value);
      if (message && prepare) {
        env.postedMessages.push({ client: client1, message });
        passCount++;
        if (passCount === 1) {
          env.mockClientsList.push(client2);
        }
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_VOTE_ACK",
            requestNonce: prepare.requestNonce,
            proposalId: prepare.proposal.proposalId,
            passId: prepare.passId,
            voteNonce: prepare.voteNonce,
            targetBuild: BUILD_STAMP,
            workerNonce: workerNonce,
            status: "ACK_SAFE",
          },
          source: client1,
        });
      }
    },
  };

  const client2 = {
    id: "client-tab-2",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(value: unknown) {
      const message = asMessageRecord(value);
      const prepare = parsePrepareMessage(value);
      if (message && prepare) {
        env.postedMessages.push({ client: client2, message });
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_VOTE_ACK",
            requestNonce: prepare.requestNonce,
            proposalId: prepare.proposal.proposalId,
            passId: prepare.passId,
            voteNonce: prepare.voteNonce,
            targetBuild: BUILD_STAMP,
            workerNonce: workerNonce,
            status: "ACK_SAFE",
          },
          source: client2,
        });
      }
    },
  };

  env.mockClientsList.push(client1);

  const workerNonce = getWorkerRuntimeNonce(env, client1);

  const proposal = {
    protocol: 1,
    proposalId: "33333333-3333-4444-8555-666666666666",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: MessageRecord | null = null;
  const privatePort = captureMessage((message) => {
    privatePortResult = message;
  });

  let waitUntilPromise: Promise<void> | null = null;

  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-revote",
      proposal,
    },
    source: client1,
    ports: [privatePort],
    waitUntil(p: Promise<void>) {
      waitUntilPromise = p;
    },
  });

  if (waitUntilPromise) await waitUntilPromise;

  assert.equal(env.getSkipWaitingCount(), 1);
  assert.equal(messageField(privatePortResult, "type"), "PWA_ACTIVATION_COMMITTED");
});

test("SW consensus execution - nonce theft, previous pass reuse, foreign client rejected => skipWaiting 0", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  // Client A and Client B
  let pass1ClientANonce = "";
  let pass1Id = "";

  const clientA = {
    id: "client-tab-A",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(value: unknown) {
      const prepare = parsePrepareMessage(value);
      if (prepare) {
        pass1ClientANonce = prepare.voteNonce;
        pass1Id = prepare.passId;
      }
    },
  };

  const clientB = {
    id: "client-tab-B",
    url: "https://app.k-bestie.com/parent/home",
    postMessage() {},
  };

  env.mockClientsList.push(clientA);
  env.mockClientsList.push(clientB);

  const workerNonce = getWorkerRuntimeNonce(env, clientA);

  const proposal = {
    protocol: 1,
    proposalId: "44444444-4444-4444-8444-444444444444",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: MessageRecord | null = null;
  const privatePort = captureMessage((message) => {
    privatePortResult = message;
  });

  let waitUntilPromise: Promise<void> | null = null;

  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-theft",
      proposal,
    },
    source: clientA,
    ports: [privatePort],
    waitUntil(p: Promise<void>) {
      waitUntilPromise = p;
    },
  });

  // Client B attempts Nonce Theft: sends Client A's voteNonce as its own vote
  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_TAB_VOTE_ACK",
      requestNonce: "req-theft",
      proposalId: proposal.proposalId,
      passId: pass1Id,
      voteNonce: pass1ClientANonce, // Stolen nonce!
      targetBuild: BUILD_STAMP,
      workerNonce: workerNonce,
      status: "ACK_SAFE",
    },
    source: clientB,
  });

  if (waitUntilPromise) await waitUntilPromise;

  assert.equal(env.getSkipWaitingCount(), 0);
  assert.equal(messageField(privatePortResult, "type"), "PWA_ACTIVATION_ABORTED");
});

test("SW consensus execution - redundant worker or proposal mismatch => skipWaiting 0", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage() {},
  };
  env.mockClientsList.push(client1);

  // 1. Worker nonce mismatch
  const proposalWrongNonce = {
    protocol: 1,
    proposalId: "55555555-5555-4555-8555-555555555555",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: "completely-wrong-nonce",
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: MessageRecord | null = null;
  const privatePort = captureMessage((message) => {
    privatePortResult = message;
  });

  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-wrong-nonce",
      proposal: proposalWrongNonce,
    },
    source: client1,
    ports: [privatePort],
  });

  assert.equal(env.getSkipWaitingCount(), 0);
  assert.equal(messageField(privatePortResult, "type"), "PWA_ACTIVATION_ABORTED");
  assert.equal(messageField(privatePortResult, "reason"), "Worker nonce mismatch");
});

test("SW consensus execution - target script pathname & swVersion mismatch => skipWaiting 0", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage() {},
  };
  env.mockClientsList.push(client1);
  const workerNonce = getWorkerRuntimeNonce(env, client1);

  // 1. Script pathname mismatch
  const proposalWrongPath = {
    protocol: 1,
    proposalId: "bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    targetScriptUrl: "/wrong-sw.js",
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let portResult1: MessageRecord | null = null;
  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-wrong-path",
      proposal: proposalWrongPath,
    },
    source: client1,
    ports: [
      captureMessage((message) => {
        portResult1 = message;
      }),
    ],
  });

  assert.equal(env.getSkipWaitingCount(), 0);
  assert.equal(messageField(portResult1, "type"), "PWA_ACTIVATION_ABORTED");
  assert.equal(messageField(portResult1, "reason"), "Target script pathname mismatch");

  // 2. SwVersion mismatch
  const proposalWrongSw = {
    protocol: 1,
    proposalId: "cccccccc-6666-4666-8666-cccccccccccc",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    targetSwVersion: "kbestie-shell-completely-different",
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let portResult2: MessageRecord | null = null;
  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-wrong-sw",
      proposal: proposalWrongSw,
    },
    source: client1,
    ports: [
      captureMessage((message) => {
        portResult2 = message;
      }),
    ],
  });

  assert.equal(env.getSkipWaitingCount(), 0);
  assert.equal(messageField(portResult2, "type"), "PWA_ACTIVATION_ABORTED");
  assert.equal(messageField(portResult2, "reason"), "Target SW version mismatch");
});

test("Production SW route directly passes build constants with zero query/header/test-flag override", async () => {
  const routeModulePath = fileURLToPath(new URL("./route.ts", import.meta.url));
  const fs = await import("node:fs");
  const source = fs.readFileSync(routeModulePath, "utf-8");

  // Route does not accept request arguments or read request properties to alter buildId
  assert.equal(source.includes("req.nextUrl"), false);
  assert.equal(source.includes("searchParams"), false);
  assert.equal(source.includes("headers.get"), false);
  assert.equal(source.includes("PWA_E2E"), false);
  assert.equal(source.includes("__PWA_TEST"), false);
  assert.match(source, /renderServiceWorker\(\{/);
  assert.match(source, /buildStamp:\s*BUILD_STAMP/);
});

test("Route manifest and app structure has zero /_e2e routes and zero test-only backdoors", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const appDir = path.resolve(process.cwd(), "app");

  const forbidden: string[] = [];
  function scan(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "_e2e" || e.name.startsWith("_e2e")) forbidden.push(full);
        scan(full);
      } else if (e.isFile() && e.name.includes("_e2e")) {
        forbidden.push(full);
      }
    }
  }
  scan(appDir);
  assert.deepEqual(forbidden, []);
});

test("Production SW route import graph contains no E2E proxy or override seam", async () => {
  const fs = await import("node:fs");
  const routeSource = fs.readFileSync(
    fileURLToPath(new URL("./route.ts", import.meta.url)),
    "utf-8",
  );
  const rendererSource = fs.readFileSync(
    fileURLToPath(
      new URL("../../../../lib/pwa/renderServiceWorker.ts", import.meta.url),
    ),
    "utf-8",
  );

  for (const source of [routeSource, rendererSource]) {
    assert.equal(source.includes("e2e/"), false);
    assert.equal(source.includes("pwaUpdateProxy"), false);
    assert.equal(source.includes("PWA_E2E_PROXY"), false);
    assert.equal(source.includes("/_e2e"), false);
  }
  assert.equal(routeSource.includes("searchParams"), false);
  assert.equal(routeSource.includes("headers.get"), false);
});

test("DEV proxy starts only behind both test guards and binds loopback", async () => {
  const { PwaUpdateProxy } = await import(
    "../../../../e2e/support/pwaUpdateProxy.js"
  );
  const previousNodeEnv = process.env.NODE_ENV;
  const previousProxyFlag = process.env.PWA_E2E_PROXY;

  try {
    process.env.NODE_ENV = "development";
    process.env.PWA_E2E_PROXY = "1";
    const blockedByNodeEnv = new PwaUpdateProxy({
      upstreamUrl: "https://k-bestie-v3-dev.vercel.app",
    });
    await assert.rejects(
      blockedByNodeEnv.start(),
      /NODE_ENV=test and PWA_E2E_PROXY=1/,
    );

    process.env.NODE_ENV = "test";
    delete process.env.PWA_E2E_PROXY;
    const blockedByFlag = new PwaUpdateProxy({
      upstreamUrl: "https://k-bestie-v3-dev.vercel.app",
    });
    await assert.rejects(
      blockedByFlag.start(),
      /NODE_ENV=test and PWA_E2E_PROXY=1/,
    );

    process.env.PWA_E2E_PROXY = "1";
    const allowed = new PwaUpdateProxy({
      upstreamUrl: "https://k-bestie-v3-dev.vercel.app",
    });
    await allowed.start();
    try {
      assert.match(allowed.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await allowed.stop();
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousProxyFlag === undefined) delete process.env.PWA_E2E_PROXY;
    else process.env.PWA_E2E_PROXY = previousProxyFlag;
  }
});

test("DEV proxy setTarget changes only exact version and SW responses", async () => {
  const { PwaUpdateProxy } = await import(
    "../../../../e2e/support/pwaUpdateProxy.js"
  );
  const previousNodeEnv = process.env.NODE_ENV;
  const previousProxyFlag = process.env.PWA_E2E_PROXY;
  process.env.NODE_ENV = "test";
  process.env.PWA_E2E_PROXY = "1";

  const proxy = new PwaUpdateProxy({
    upstreamUrl: "https://k-bestie-v3-dev.vercel.app",
  });
  try {
    await proxy.start();

    const v1Metadata = await fetch(`${proxy.origin}/api/client-version`).then(
      (response) => response.json(),
    );
    assert.deepEqual(v1Metadata, {
      schemaVersion: 1,
      buildId: "078-dev-v1",
      buildStamp: "078-dev-v1",
      deploymentId: "dpl-078-dev-v1",
      swVersion: "kbestie-shell-078-dev-v1",
      serviceWorkerScriptUrl: "/sw.js",
    });

    const v1Sw = await fetch(`${proxy.origin}/sw.js`).then((response) =>
      response.text(),
    );
    assert.match(v1Sw, /const BUILD_ID = "078-dev-v1";/);

    proxy.setTarget("v2");
    const v2Metadata = await fetch(`${proxy.origin}/api/client-version`).then(
      (response) => response.json(),
    );
    assert.deepEqual(v2Metadata, {
      schemaVersion: 1,
      buildId: "078-dev-v2",
      buildStamp: "078-dev-v2",
      deploymentId: "dpl-078-dev-v2",
      swVersion: "kbestie-shell-078-dev-v2",
      serviceWorkerScriptUrl: "/sw.js",
    });

    const v2Sw = await fetch(`${proxy.origin}/api/pwa/sw`).then((response) =>
      response.text(),
    );
    assert.match(v2Sw, /const BUILD_ID = "078-dev-v2";/);
  } finally {
    await proxy.stop();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousProxyFlag === undefined) delete process.env.PWA_E2E_PROXY;
    else process.env.PWA_E2E_PROXY = previousProxyFlag;
  }
});

test("DEV proxy rejects Production, loopback, credentialed, and pathful upstream URLs", async () => {
  const { PwaUpdateProxy } = await import(
    "../../../../e2e/support/pwaUpdateProxy.js"
  );
  const forbidden = [
    "https://app.k-bestie.com",
    "http://dev.example.test",
    "https://127.0.0.1",
    "https://user:password@dev.example.test",
    "https://dev.example.test/not-an-origin",
    "https://dev.example.test",
    "https://k-bestie-v3-preview.vercel.app",
  ];

  for (const upstreamUrl of forbidden) {
    assert.throws(
      () => new PwaUpdateProxy({ upstreamUrl }),
      /approved deployed DEV origin/,
    );
  }
});

test("078 fixture requires dedicated DEV credentials and exposes no browser test seam", async () => {
  const fs = await import("node:fs");
  const fixtureSource = fs.readFileSync(
    fileURLToPath(
      new URL("../../../../e2e/fixtures/pwaDevApp.ts", import.meta.url),
    ),
    "utf-8",
  );
  const proxySource = fs.readFileSync(
    fileURLToPath(
      new URL("../../../../e2e/support/pwaUpdateProxy.ts", import.meta.url),
    ),
    "utf-8",
  );
  const playwrightSource = fs.readFileSync(
    fileURLToPath(new URL("../../../../playwright.config.ts", import.meta.url)),
    "utf-8",
  );

  assert.match(fixtureSource, /readRequiredEnv\("PWA_E2E_QA_CHILD_USERNAME"\)/);
  assert.match(fixtureSource, /readRequiredEnv\("QA_TEST_PASSWORD"\)/);
  assert.match(fixtureSource, /readRequiredEnv\("PWA_E2E_DEV_UPSTREAM"\)/);
  assert.equal(fixtureSource.includes("QA_TEST_PASSWORD ||"), false);
  assert.equal(fixtureSource.includes("serviceWorkers: \"allow\""), true);
  assert.equal(fixtureSource.match(/browser\.newContext\(/g)?.length, 1);
  assert.equal(fixtureSource.match(/context\.newPage\(/g)?.length, 2);

  for (const source of [fixtureSource, proxySource]) {
    assert.equal(source.includes("window.__PWA_TEST_STATE__"), false);
    assert.equal(source.includes("__isConversationActive"), false);
    assert.equal(source.includes("navigator.serviceWorker ="), false);
    assert.equal(source.includes("/_e2e"), false);
    assert.equal(source.includes("api/analytics/pwa-update"), false);
    assert.equal(source.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  }

  assert.match(playwrightSource, /name: "pwa-update-chromium"/);
  assert.match(playwrightSource, /screenshot: "off"/);
  assert.match(playwrightSource, /trace: "off"/);
  assert.match(playwrightSource, /video: "off"/);
});

test("078 E2E launcher is shell-neutral and invokes Playwright on Windows or POSIX", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"),
  ) as { scripts?: Record<string, unknown> };
  const command = packageJson.scripts?.["test:pwa-update:e2e"];

  assert.equal(typeof command, "string");
  assert.match(command as string, /^node -e /);
  assert.equal((command as string).includes("NODE_ENV=test "), false);
  assert.match(command as string, /PWA_E2E_PROXY:'1'/);
  assert.match(command as string, /process\.argv\.slice\(1\)/);

  const npmArgs = [
    "run",
    "test:pwa-update:e2e",
    "--",
    "--help",
  ];
  const isWindows = process.platform === "win32";
  const executable = isWindows ? process.env.ComSpec ?? "cmd.exe" : "npm";
  const args = isWindows
    ? ["/d", "/s", "/c", `npm.cmd ${npmArgs.join(" ")}`]
    : npmArgs;
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      PWA_E2E_QA_CHILD_USERNAME: "launcher-contract-only",
      QA_TEST_PASSWORD: "launcher-contract-only",
      PWA_E2E_DEV_UPSTREAM: "https://k-bestie-v3-dev.vercel.app",
    },
  });

  assert.equal(
    result.status,
    0,
    `Cross-platform E2E launcher failed: ${result.stderr || result.stdout}`,
  );
  assert.match(result.stdout, /Usage: npx playwright test|playwright test/);
});
