import assert from "node:assert/strict";
import test from "node:test";

import {
  PwaUpdateProxy,
  type PwaTargetConfig,
} from "./pwaUpdateProxy.js";

const targets: Readonly<Record<"v1" | "v2", PwaTargetConfig>> = {
  v1: {
    schemaVersion: 1,
    buildId: "request-boundary-v1",
    buildStamp: "stamp-v1",
    deploymentId: "deployment-v1",
    swVersion: "shell-v1",
    serviceWorkerScriptUrl: "/sw.js",
  },
  v2: {
    schemaVersion: 1,
    buildId: "request-boundary-v2",
    buildStamp: "stamp-v2",
    deploymentId: "deployment-v2",
    swVersion: "shell-v2",
    serviceWorkerScriptUrl: "/sw.js",
  },
};

const createProxy = (): PwaUpdateProxy =>
  new PwaUpdateProxy({
    upstreamUrl: "https://k-bestie-v3-dev.vercel.app",
    targets,
  });

const withTestRuntime = async (run: () => Promise<void>): Promise<void> => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousProxyFlag = process.env.PWA_E2E_PROXY;
  process.env.NODE_ENV = "test";
  process.env.PWA_E2E_PROXY = "1";
  try {
    await run();
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousProxyFlag === undefined) delete process.env.PWA_E2E_PROXY;
    else process.env.PWA_E2E_PROXY = previousProxyFlag;
  }
};

test("loopback client-version modes return exact normal, 503 JSON, and raw malformed bytes", async () => {
  await withTestRuntime(async () => {
    const proxy = createProxy();
    await proxy.start();
    try {
      const normal = await fetch(`${proxy.origin}/api/client-version`);
      assert.equal(normal.status, 200);
      assert.match(normal.headers.get("cache-control") ?? "", /no-store/);
      assert.match(normal.headers.get("content-type") ?? "", /^application\/json/);
      assert.deepEqual(await normal.json(), targets.v1);

      proxy.setClientVersionMode("http-503");
      const unavailable = await fetch(`${proxy.origin}/api/client-version`);
      assert.equal(unavailable.status, 503);
      assert.match(unavailable.headers.get("cache-control") ?? "", /no-store/);
      assert.deepEqual(await unavailable.json(), {
        error: "client-version unavailable",
      });

      proxy.setClientVersionMode("malformed-json");
      const malformed = await fetch(`${proxy.origin}/api/client-version`);
      assert.equal(malformed.status, 200);
      assert.match(malformed.headers.get("content-type") ?? "", /^application\/json/);
      const rawBody = await malformed.text();
      assert.equal(rawBody, '{"schemaVersion":1');
      assert.throws(() => JSON.parse(rawBody));
    } finally {
      await proxy.stop();
    }
  });
});

test("latest metadata and service-worker targets are independent real HTTP responses", async () => {
  await withTestRuntime(async () => {
    const proxy = createProxy();
    await proxy.start();
    try {
      proxy.setLatestTarget("v2");
      proxy.setServiceWorkerTarget("v1");

      const latest = await fetch(`${proxy.origin}/api/client-version`);
      assert.deepEqual(await latest.json(), targets.v2);

      const worker = await fetch(`${proxy.origin}/sw.js`);
      const workerBody = await worker.text();
      assert.equal(worker.status, 200);
      assert.match(worker.headers.get("content-type") ?? "", /^application\/javascript/);
      assert.match(workerBody, /request-boundary-v1/);
      assert.match(workerBody, /shell-v1/);
      assert.doesNotMatch(workerBody, /request-boundary-v2/);
      assert.doesNotMatch(workerBody, /shell-v2/);
    } finally {
      await proxy.stop();
    }
  });
});

test("request-start snapshots stay immutable across concurrent state boundaries and reset on stop", async () => {
  await withTestRuntime(async () => {
    const proxy = createProxy();
    await proxy.start();
    try {
      proxy.setLatestTarget("v1");
      const firstResponse = await fetch(`${proxy.origin}/api/client-version`);

      proxy.setLatestTarget("v2");
      const secondResponse = await fetch(`${proxy.origin}/api/client-version`);

      assert.deepEqual(await firstResponse.json(), targets.v1);
      assert.deepEqual(await secondResponse.json(), targets.v2);

      proxy.setClientVersionMode("malformed-json");
      const malformedResponse = await fetch(`${proxy.origin}/api/client-version`);
      proxy.setClientVersionMode("normal");
      assert.equal(await malformedResponse.text(), '{"schemaVersion":1');

      proxy.resetFaults();
      const manuallyReset = await fetch(`${proxy.origin}/api/client-version`);
      assert.deepEqual(await manuallyReset.json(), targets.v1);
    } finally {
      await proxy.stop();
    }

    await proxy.start();
    try {
      const afterRestart = await fetch(`${proxy.origin}/api/client-version`);
      assert.deepEqual(await afterRestart.json(), targets.v1);
      const workerAfterRestart = await fetch(`${proxy.origin}/sw.js`);
      assert.match(await workerAfterRestart.text(), /shell-v1/);
    } finally {
      await proxy.stop();
    }
  });
});
