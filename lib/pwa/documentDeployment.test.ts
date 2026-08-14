import test from "node:test";
import assert from "node:assert/strict";
import {
  DocumentDeploymentMarkerV1,
  DOCUMENT_DEPLOYMENT_META_NAME,
  parseDocumentDeploymentMarker,
  serializeDocumentDeploymentMarker,
  getDocumentDeploymentMarker,
  createPwaGateHistoryState,
  parsePwaGateHistoryState,
  isOwnedPwaGateHistoryState,
} from "./documentDeployment";

test("parseDocumentDeploymentMarker - Parses valid marker object and JSON string", () => {
  const valid: DocumentDeploymentMarkerV1 = {
    schemaVersion: 1,
    buildId: "build-2026-08-15.1",
    buildStamp: "stamp-2026-08-15.1",
    deploymentId: "dpl_abc123",
  };

  assert.deepEqual(parseDocumentDeploymentMarker(valid), valid);
  assert.deepEqual(
    parseDocumentDeploymentMarker(JSON.stringify(valid)),
    valid,
  );
});

test("parseDocumentDeploymentMarker - Rejects missing fields", () => {
  const valid: DocumentDeploymentMarkerV1 = {
    schemaVersion: 1,
    buildId: "build-1",
    buildStamp: "stamp-1",
    deploymentId: "dpl-1",
  };

  const keys: (keyof DocumentDeploymentMarkerV1)[] = [
    "schemaVersion",
    "buildId",
    "buildStamp",
    "deploymentId",
  ];

  for (const key of keys) {
    const copy: Partial<DocumentDeploymentMarkerV1> = { ...valid };
    delete copy[key];
    assert.equal(
      parseDocumentDeploymentMarker(copy),
      null,
      `Expected rejection when missing ${key}`,
    );
  }
});

test("parseDocumentDeploymentMarker - Rejects unknown keys, bad schema version, or empty strings", () => {
  const valid: DocumentDeploymentMarkerV1 = {
    schemaVersion: 1,
    buildId: "build-1",
    buildStamp: "stamp-1",
    deploymentId: "dpl-1",
  };

  assert.equal(
    parseDocumentDeploymentMarker({ ...valid, unknownField: "bad" }),
    null,
  );
  assert.equal(
    parseDocumentDeploymentMarker({ ...valid, schemaVersion: 2 }),
    null,
  );
  assert.equal(
    parseDocumentDeploymentMarker({ ...valid, buildId: "" }),
    null,
  );
  assert.equal(
    parseDocumentDeploymentMarker({ ...valid, buildStamp: "   " }),
    null,
  );
  assert.equal(
    parseDocumentDeploymentMarker({ ...valid, deploymentId: "dpl#hash" }),
    null,
  );
});

test("serializeDocumentDeploymentMarker - Round-trip serialization and error on invalid", () => {
  const valid: DocumentDeploymentMarkerV1 = {
    schemaVersion: 1,
    buildId: "build-v1",
    buildStamp: "stamp-v1",
    deploymentId: "dpl-v1",
  };

  const str = serializeDocumentDeploymentMarker(valid);
  assert.deepEqual(JSON.parse(str), valid);

  assert.throws(() => {
    serializeDocumentDeploymentMarker({ ...valid, buildId: "" });
  });
});

test("getDocumentDeploymentMarker - DOM reader enforces exact single meta tag constraint", () => {
  const valid: DocumentDeploymentMarkerV1 = {
    schemaVersion: 1,
    buildId: "build-dom",
    buildStamp: "stamp-dom",
    deploymentId: "dpl-dom",
  };

  // 1. Exact 1 valid meta tag -> success
  const mockDocValid = {
    querySelectorAll: (selector: string) => {
      if (selector === `meta[name="${DOCUMENT_DEPLOYMENT_META_NAME}"]`) {
        return [
          {
            getAttribute: (attr: string) =>
              attr === "content" ? JSON.stringify(valid) : null,
          },
        ];
      }
      return [];
    },
  };
  assert.deepEqual(getDocumentDeploymentMarker(mockDocValid), valid);

  // 2. Missing meta tag (0 elements) -> null
  const mockDocMissing = {
    querySelectorAll: () => [],
  };
  assert.equal(getDocumentDeploymentMarker(mockDocMissing), null);

  // 3. Duplicate meta tags (2 elements) -> strict null (fail closed)
  const mockDocDuplicate = {
    querySelectorAll: (selector: string) => {
      if (selector === `meta[name="${DOCUMENT_DEPLOYMENT_META_NAME}"]`) {
        return [
          { getAttribute: () => JSON.stringify(valid) },
          { getAttribute: () => JSON.stringify(valid) },
        ];
      }
      return [];
    },
  };
  assert.equal(getDocumentDeploymentMarker(mockDocDuplicate), null);

  // 4. Empty content in meta tag -> null
  const mockDocEmptyContent = {
    querySelectorAll: (selector: string) => {
      if (selector === `meta[name="${DOCUMENT_DEPLOYMENT_META_NAME}"]`) {
        return [{ getAttribute: () => "   " }];
      }
      return [];
    },
  };
  assert.equal(getDocumentDeploymentMarker(mockDocEmptyContent), null);

  // 5. Malformed content in meta tag -> null
  const mockDocMalformed = {
    querySelectorAll: (selector: string) => {
      if (selector === `meta[name="${DOCUMENT_DEPLOYMENT_META_NAME}"]`) {
        return [{ getAttribute: () => "invalid_json{" }];
      }
      return [];
    },
  };
  assert.equal(getDocumentDeploymentMarker(mockDocMalformed), null);
});

test("PwaGateHistoryStateV1 preserves only exact UUID ownership and original URL", () => {
  const token = "11111111-1111-4111-8111-111111111111";
  const state = createPwaGateHistoryState(token, "/child/home?from=pwa#gate");
  assert.deepEqual(state, {
    schemaVersion: 1,
    gateToken: token,
    originalUrl: "/child/home?from=pwa#gate",
  });
  assert.deepEqual(parsePwaGateHistoryState(state), state);
  assert.equal(isOwnedPwaGateHistoryState(state, token), true);
  assert.equal(
    isOwnedPwaGateHistoryState(
      state,
      "22222222-2222-4222-8222-222222222222",
    ),
    false,
  );

  for (const invalid of [
    null,
    "primitive",
    1,
    [],
    {},
    { schemaVersion: 1, gateToken: "not-a-uuid", originalUrl: "/child/home" },
    { schemaVersion: 1, gateToken: token, originalUrl: "https://evil.test" },
    { schemaVersion: 1, gateToken: token, originalUrl: "/child/home", foreign: true },
  ]) {
    assert.equal(parsePwaGateHistoryState(invalid), null);
    assert.equal(isOwnedPwaGateHistoryState(invalid, token), false);
  }
});
