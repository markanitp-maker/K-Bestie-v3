import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "./route.js";
import { BUILD_STAMP } from "../../../../lib/pwa/buildStamp.js";

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

test("SW 응답은 동일 renderer 입력 시 byte-for-byte 고정되며 Promise.all이 0건이다", async () => {
  const response1 = await GET();
  const source1 = await response1.text();

  const response2 = await GET();
  const source2 = await response2.text();

  // Stable bytes requirement
  assert.equal(source1, source2);

  // No Promise.all in generated SW script
  assert.equal(source1.includes("Promise.all("), false);

  assert.match(source1, /kbestie-shell-/);
  assert.match(source1, /const SW_INSTANCE_NONCE = crypto\.randomUUID\(\);/);
  assert.match(response1.headers.get("cache-control") || "", /no-cache/);
  assert.match(response1.headers.get("cache-control") || "", /no-store/);
  assert.equal(response1.headers.get("service-worker-allowed"), "/");
  assert.match(source1, new RegExp(BUILD_STAMP.replaceAll(".", "\\.")));
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

function createMockSwEnvironment(swSource: string) {
  const listeners: Record<string, Function> = {};
  let skipWaitingCalls = 0;
  const postedMessages: Array<{ client: any; message: any }> = [];

  const mockClientsList: Array<{ id: string; url: string; postMessage: (msg: any) => void }> = [];

  const mockSelf = {
    location: { origin: "https://app.k-bestie.com" },
    addEventListener(event: string, callback: Function) {
      listeners[event] = callback;
    },
    skipWaiting() {
      skipWaitingCalls++;
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

  const mockCrypto = {
    randomUUID: (() => {
      let counter = 0;
      return () => `mock-uuid-${++counter}`;
    })(),
  };

  const runner = new Function("self", "console", "crypto", swSource);
  runner(mockSelf, { log: () => {}, warn: () => {}, error: () => {} }, mockCrypto);

  return {
    listeners,
    getSkipWaitingCount: () => skipWaitingCalls,
    mockClientsList,
    postedMessages,
    mockCrypto,
  };
}

test("SW identity handshake - PWA_GET_IDENTITY (v1) and GET_VERSION (v0 legacy)", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage() {},
  };

  let port1Msg: any = null;
  const mockPort = {
    postMessage(m: any) {
      port1Msg = m;
    },
  };

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
  assert.equal(port1Msg.protocol, 1);
  assert.equal(port1Msg.type, "PWA_IDENTITY_RESPONSE");
  assert.equal(port1Msg.requestNonce, "req-ident-1");
  assert.equal(port1Msg.buildId, BUILD_STAMP);
  assert.match(port1Msg.workerNonce, /^mock-uuid-/);

  // 2. GET_VERSION -> returns protocol 0 with workerNonce: null
  let legacyMsg: any = null;
  const legacyPort = {
    postMessage(m: any) {
      legacyMsg = m;
    },
  };

  env.listeners["message"]({
    data: {
      type: "GET_VERSION",
      requestNonce: "req-legacy-1",
    },
    source: client1,
    ports: [legacyPort],
  });

  assert.notEqual(legacyMsg, null);
  assert.equal(legacyMsg.protocol, 0);
  assert.equal(legacyMsg.type, "VERSION_RESPONSE");
  assert.equal(legacyMsg.workerNonce, null);
});

test("SW consensus execution - NACK / active / timeout => skipWaiting 0", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  // The runtime nonce created when SW script evaluates
  const workerNonce = "mock-uuid-1";

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(msg: any) {
      env.postedMessages.push({ client: client1, message: msg });
      if (msg && msg.type === "PWA_TAB_PREPARE") {
        // Client responds with PWA_TAB_NACK (without clientId in message, matching by passId and voteNonce)
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_NACK",
            requestNonce: msg.requestNonce,
            proposalId: msg.proposal.proposalId,
            passId: msg.passId,
            voteNonce: msg.voteNonce,
            status: "NACK_ACTIVE",
            reason: "Conversation active",
          },
          source: client1,
        });
      }
    },
  };
  env.mockClientsList.push(client1);

  const proposal = {
    protocol: 1,
    proposalId: "11111111-2222-4333-8444-555555555555",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: any = null;
  const privatePort = {
    postMessage(msg: any) {
      privatePortResult = msg;
    },
  };

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
  assert.equal(privatePortResult.type, "PWA_ACTIVATION_ABORTED");
});

test("SW consensus execution - 2 stable passes with unanimous ACKs => skipWaiting 1", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const workerNonce = "mock-uuid-1";

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(msg: any) {
      env.postedMessages.push({ client: client1, message: msg });
      if (msg && msg.type === "PWA_TAB_PREPARE") {
        // Automatically respond ACK for each pass using received passId & voteNonce
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_ACK",
            requestNonce: msg.requestNonce,
            proposalId: msg.proposal.proposalId,
            passId: msg.passId,
            voteNonce: msg.voteNonce,
            status: "ACK_SAFE",
          },
          source: client1,
        });
      }
    },
  };
  env.mockClientsList.push(client1);

  const proposal = {
    protocol: 1,
    proposalId: "22222222-3333-4444-8555-666666666666",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: any = null;
  const privatePort = {
    postMessage(msg: any) {
      privatePortResult = msg;
    },
  };

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
  assert.equal(privatePortResult.type, "PWA_ACTIVATION_COMMITTED");
  assert.equal(privatePortResult.workerNonce, workerNonce);
});

test("SW consensus execution - client set changes triggers pass restart", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const workerNonce = "mock-uuid-1";
  let passCount = 0;

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(msg: any) {
      env.postedMessages.push({ client: client1, message: msg });
      if (msg && msg.type === "PWA_TAB_PREPARE") {
        passCount++;
        if (passCount === 1) {
          // On pass 1, a new client appears in mockClientsList
          env.mockClientsList.push(client2);
        }
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_ACK",
            requestNonce: msg.requestNonce,
            proposalId: msg.proposal.proposalId,
            passId: msg.passId,
            voteNonce: msg.voteNonce,
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
    postMessage(msg: any) {
      env.postedMessages.push({ client: client2, message: msg });
      if (msg && msg.type === "PWA_TAB_PREPARE") {
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_ACK",
            requestNonce: msg.requestNonce,
            proposalId: msg.proposal.proposalId,
            passId: msg.passId,
            voteNonce: msg.voteNonce,
            status: "ACK_SAFE",
          },
          source: client2,
        });
      }
    },
  };

  env.mockClientsList.push(client1);

  const proposal = {
    protocol: 1,
    proposalId: "33333333-3333-4444-8555-666666666666",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: any = null;
  const privatePort = {
    postMessage(msg: any) {
      privatePortResult = msg;
    },
  };

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

  // After client2 joined, set reset and stabilized for {client1, client2}
  assert.equal(env.getSkipWaitingCount(), 1);
  assert.equal(privatePortResult?.type, "PWA_ACTIVATION_COMMITTED");
});

test("SW consensus execution - wrong voteNonce or forged passId rejected", async () => {
  const response = await GET();
  const swSource = await response.text();
  const env = createMockSwEnvironment(swSource);

  const workerNonce = "mock-uuid-1";

  const client1 = {
    id: "client-tab-1",
    url: "https://app.k-bestie.com/parent/home",
    postMessage(msg: any) {
      env.postedMessages.push({ client: client1, message: msg });
      if (msg && msg.type === "PWA_TAB_PREPARE") {
        // Send ACK with WRONG voteNonce
        env.listeners["message"]({
          data: {
            protocol: 1,
            type: "PWA_TAB_ACK",
            requestNonce: msg.requestNonce,
            proposalId: msg.proposal.proposalId,
            passId: msg.passId,
            voteNonce: "forged-wrong-vote-nonce",
            status: "ACK_SAFE",
          },
          source: client1,
        });
      }
    },
  };
  env.mockClientsList.push(client1);

  const proposal = {
    protocol: 1,
    proposalId: "44444444-3333-4444-8555-666666666666",
    ownerTabId: "11111111-2222-4333-8444-555555555555",
    targetBuild: BUILD_STAMP,
    workerNonce: workerNonce,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 30000,
  };

  let privatePortResult: any = null;
  const privatePort = {
    postMessage(msg: any) {
      privatePortResult = msg;
    },
  };

  let waitUntilPromise: Promise<void> | null = null;

  env.listeners["message"]({
    data: {
      protocol: 1,
      type: "PWA_PREPARE_ACTIVATION",
      requestNonce: "req-forged",
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
  assert.equal(privatePortResult?.type, "PWA_ACTIVATION_ABORTED");
});
