import test from "node:test";
import assert from "node:assert/strict";
import {
  PWA_CLIENT_VERSION,
  LatestVersionMetadataV1,
  parseLatestVersionMetadata,
  serializeLatestVersionMetadata,
  isCanonicalScriptPath,
  fetchLatestVersionMetadataV1,
  areLatestVersionMetadataEqual,
} from "./clientVersion";

const latest: LatestVersionMetadataV1 = {
  schemaVersion: 1,
  buildId: "build-2",
  buildStamp: "stamp-2",
  deploymentId: "dpl-2",
  swVersion: "sw-2",
  serviceWorkerScriptUrl: "/sw.js",
};

test("PWA_CLIENT_VERSION is non-empty string", () => {
  assert.equal(typeof PWA_CLIENT_VERSION, "string");
  assert.ok(PWA_CLIENT_VERSION.length > 0);
});

test("parseLatestVersionMetadata - Valid object and JSON string parse successfully", () => {
  const valid: LatestVersionMetadataV1 = {
    schemaVersion: 1,
    buildId: "build-2026-08-15.1",
    buildStamp: "stamp-2026-08-15.1",
    deploymentId: "dpl_abc123",
    swVersion: "kbestie-shell-2026-08-15.1",
    serviceWorkerScriptUrl: "/sw.js",
  };

  const parsedFromObj = parseLatestVersionMetadata(valid);
  assert.deepEqual(parsedFromObj, valid);

  const jsonStr = JSON.stringify(valid);
  const parsedFromJson = parseLatestVersionMetadata(jsonStr);
  assert.deepEqual(parsedFromJson, valid);
});

test("parseLatestVersionMetadata - Rejects missing required fields", () => {
  const base: LatestVersionMetadataV1 = {
    schemaVersion: 1,
    buildId: "build-1",
    buildStamp: "stamp-1",
    deploymentId: "dpl-1",
    swVersion: "sw-1",
    serviceWorkerScriptUrl: "/sw.js",
  };

  const keys: (keyof LatestVersionMetadataV1)[] = [
    "schemaVersion",
    "buildId",
    "buildStamp",
    "deploymentId",
    "swVersion",
    "serviceWorkerScriptUrl",
  ];

  for (const key of keys) {
    const copy: Partial<LatestVersionMetadataV1> = { ...base };
    delete copy[key];
    assert.equal(
      parseLatestVersionMetadata(copy),
      null,
      `Expected rejection when missing ${key}`,
    );
  }
});

test("parseLatestVersionMetadata - Rejects unknown or extra keys", () => {
  const valid: LatestVersionMetadataV1 = {
    schemaVersion: 1,
    buildId: "build-1",
    buildStamp: "stamp-1",
    deploymentId: "dpl-1",
    swVersion: "sw-1",
    serviceWorkerScriptUrl: "/sw.js",
  };

  assert.equal(
    parseLatestVersionMetadata({ ...valid, extraKey: "injection" }),
    null,
  );
  assert.equal(
    parseLatestVersionMetadata({ ...valid, attacker_payload: true }),
    null,
  );
});

test("parseLatestVersionMetadata - Rejects invalid schemaVersion", () => {
  const base = {
    buildId: "build-1",
    buildStamp: "stamp-1",
    deploymentId: "dpl-1",
    swVersion: "sw-1",
    serviceWorkerScriptUrl: "/sw.js",
  };

  assert.equal(parseLatestVersionMetadata({ ...base, schemaVersion: 2 }), null);
  assert.equal(parseLatestVersionMetadata({ ...base, schemaVersion: 0 }), null);
  assert.equal(parseLatestVersionMetadata({ ...base, schemaVersion: "1" }), null);
  assert.equal(parseLatestVersionMetadata({ ...base, schemaVersion: null }), null);
});

test("parseLatestVersionMetadata - Rejects empty strings and whitespace-only strings", () => {
  const valid: LatestVersionMetadataV1 = {
    schemaVersion: 1,
    buildId: "build-1",
    buildStamp: "stamp-1",
    deploymentId: "dpl-1",
    swVersion: "sw-1",
    serviceWorkerScriptUrl: "/sw.js",
  };

  assert.equal(parseLatestVersionMetadata({ ...valid, buildId: "" }), null);
  assert.equal(parseLatestVersionMetadata({ ...valid, buildStamp: "   " }), null);
  assert.equal(parseLatestVersionMetadata({ ...valid, deploymentId: "" }), null);
  assert.equal(parseLatestVersionMetadata({ ...valid, swVersion: " " }), null);
  assert.equal(parseLatestVersionMetadata({ ...valid, serviceWorkerScriptUrl: "" }), null);
});

test("parseLatestVersionMetadata - Rejects invalid serviceWorkerScriptUrl formats", () => {
  const base: LatestVersionMetadataV1 = {
    schemaVersion: 1,
    buildId: "build-1",
    buildStamp: "stamp-1",
    deploymentId: "dpl-1",
    swVersion: "sw-1",
    serviceWorkerScriptUrl: "/sw.js",
  };

  const invalidUrls = [
    "https://evil.com/sw.js",
    "http://localhost/sw.js",
    "//evil.com/sw.js",
    "sw.js",
    "./sw.js",
    "/../sw.js",
    "/nested/../sw.js",
    "/./sw.js",
    "/sw.js?v=123",
    "/sw.js#hash",
    "\\sw.js",
    "/sw.js%00",
    "/%2fsw.js",
    "/sw.js%3fquery",
    "/sw.js%23frag",
    "/sw.js%5cbad",
    "/sw.js%2edot",
  ];

  for (const url of invalidUrls) {
    assert.equal(
      parseLatestVersionMetadata({ ...base, serviceWorkerScriptUrl: url }),
      null,
      `Expected rejection for invalid URL: ${url}`,
    );
    assert.equal(
      isCanonicalScriptPath(url),
      false,
      `isCanonicalScriptPath should be false for: ${url}`,
    );
  }
});

test("parseLatestVersionMetadata - Rejects strings with control characters, queries, hashes, or encoded delimiters in IDs", () => {
  const valid: LatestVersionMetadataV1 = {
    schemaVersion: 1,
    buildId: "build-1",
    buildStamp: "stamp-1",
    deploymentId: "dpl-1",
    swVersion: "sw-1",
    serviceWorkerScriptUrl: "/sw.js",
  };

  assert.equal(parseLatestVersionMetadata({ ...valid, buildId: "build-1?param=1" }), null);
  assert.equal(parseLatestVersionMetadata({ ...valid, buildStamp: "stamp#1" }), null);
  assert.equal(parseLatestVersionMetadata({ ...valid, deploymentId: "dpl%00null" }), null);
  assert.equal(parseLatestVersionMetadata({ ...valid, swVersion: "sw\nversion" }), null);
});

test("serializeLatestVersionMetadata - Serializes valid metadata and throws on invalid", () => {
  const valid: LatestVersionMetadataV1 = {
    schemaVersion: 1,
    buildId: "build-v1",
    buildStamp: "stamp-v1",
    deploymentId: "dpl-v1",
    swVersion: "sw-v1",
    serviceWorkerScriptUrl: "/sw.js",
  };

  const serialized = serializeLatestVersionMetadata(valid);
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed, valid);

  assert.throws(() => {
    serializeLatestVersionMetadata({ ...valid, buildId: "" });
  });
});

test("fetchLatestVersionMetadataV1 - sends the strict no-store same-origin request and freezes a fresh snapshot", async () => {
  let requestInput: RequestInfo | URL | undefined;
  let requestInit: RequestInit | undefined;
  const result = await fetchLatestVersionMetadataV1({
    fetchImpl: async (input, init) => {
      requestInput = input;
      requestInit = init;
      return new Response(JSON.stringify(latest), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    },
  });

  assert.equal(requestInput, "/api/client-version");
  assert.equal(requestInit?.method, "GET");
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(requestInit?.credentials, "same-origin");
  assert.equal(requestInit?.redirect, "manual");
  assert.equal(new Headers(requestInit?.headers).get("accept"), "application/json");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.snapshot, latest);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.deepEqual(result.snapshot, latest);
});

test("fetchLatestVersionMetadataV1 - maps network, timeout, HTTP, redirect, and media failures exactly", async () => {
  const network = await fetchLatestVersionMetadataV1({
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.deepEqual(network, { ok: false, code: "network" });

  const timeout = await fetchLatestVersionMetadataV1({
    timeoutMs: 5,
    fetchImpl: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });
  assert.deepEqual(timeout, { ok: false, code: "timeout" });

  const http = await fetchLatestVersionMetadataV1({
    fetchImpl: async () =>
      new Response("failed", {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.deepEqual(http, { ok: false, code: "http" });

  const redirect = await fetchLatestVersionMetadataV1({
    fetchImpl: async () => new Response(null, { status: 302 }),
  });
  assert.deepEqual(redirect, { ok: false, code: "redirect" });

  const media = await fetchLatestVersionMetadataV1({
    fetchImpl: async () =>
      new Response(JSON.stringify(latest), {
        headers: { "content-type": "text/html" },
      }),
  });
  assert.deepEqual(media, { ok: false, code: "media" });
});

test("fetchLatestVersionMetadataV1 - maps oversize, malformed JSON, and strict schema failures exactly", async () => {
  const oversize = await fetchLatestVersionMetadataV1({
    maxBytes: 8,
    fetchImpl: async () =>
      new Response(JSON.stringify(latest), {
        headers: { "content-type": "application/json" },
      }),
  });
  assert.deepEqual(oversize, { ok: false, code: "oversize" });

  const declaredOversize = await fetchLatestVersionMetadataV1({
    maxBytes: 8,
    fetchImpl: async () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "9",
        },
      }),
  });
  assert.deepEqual(declaredOversize, { ok: false, code: "oversize" });

  const malformed = await fetchLatestVersionMetadataV1({
    fetchImpl: async () =>
      new Response("{", { headers: { "content-type": "application/json" } }),
  });
  assert.deepEqual(malformed, { ok: false, code: "malformed" });

  const invalidSchema = await fetchLatestVersionMetadataV1({
    fetchImpl: async () =>
      new Response(JSON.stringify({ ...latest, unexpected: true }), {
        headers: { "content-type": "application/json" },
      }),
  });
  assert.deepEqual(invalidSchema, { ok: false, code: "invalid-schema" });
});

test("areLatestVersionMetadataEqual - compares all six schema fields", () => {
  assert.equal(areLatestVersionMetadataEqual(latest, { ...latest }), true);
  assert.equal(
    areLatestVersionMetadataEqual(latest, { ...latest, deploymentId: "dpl-3" }),
    false,
  );
  assert.equal(
    areLatestVersionMetadataEqual(latest, { ...latest, swVersion: "sw-3" }),
    false,
  );
  assert.equal(areLatestVersionMetadataEqual(latest, null), false);
});
