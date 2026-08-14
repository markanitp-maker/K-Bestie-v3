import test from "node:test";
import assert from "node:assert/strict";
import {
  GET,
  POST,
  isValidJsonContentType,
  isGenuineNoSessionAuthError,
  readJsonStreamWithLimit,
  ClientVersionGetDeps,
  ClientVersionPostDeps,
} from "./route.js";
import { BUILD_STAMP } from "../../../lib/pwa/buildStamp.js";
import { parseLatestVersionMetadata } from "../../../lib/pwa/clientVersion.js";
import { AppSessionError } from "../../../lib/analytics/appSession.js";

interface RequestInitWithDuplex extends RequestInit {
  duplex?: "half" | "full";
}

function createStreamRequest(
  body: string | Uint8Array,
  headers: Record<string, string> = { "content-type": "application/json" },
): Request {
  const stream = new ReadableStream({
    start(controller) {
      if (typeof body === "string") {
        controller.enqueue(new TextEncoder().encode(body));
      } else {
        controller.enqueue(body);
      }
      controller.close();
    },
  });

  const init: RequestInitWithDuplex = {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  };

  return new Request("https://app.k-bestie.com/api/client-version", init);
}

const MOCK_ACTOR = {
  actorId: "actor-11111111-1111-4111-8111-111111111111",
  actorType: "child" as const,
  familyId: "family-22222222-2222-4222-8222-222222222222",
  childId: "child-33333333-3333-4333-8333-333333333333",
};

test("GET returns 200 with complete LatestVersionMetadataV1 and no-store headers", async () => {
  const response = await GET();
  assert.equal(response.status, 200);

  const cacheControl = response.headers.get("cache-control") || "";
  assert.match(cacheControl, /no-store/);
  assert.match(cacheControl, /no-cache/);
  assert.match(cacheControl, /must-revalidate/);

  const json = await response.json();
  const parsed = parseLatestVersionMetadata(json);
  assert.notEqual(parsed, null, "GET response must strictly parse as LatestVersionMetadataV1");
  assert.equal(parsed?.schemaVersion, 1);
  assert.equal(parsed?.buildId, BUILD_STAMP);
  assert.equal(parsed?.buildStamp, BUILD_STAMP);
  assert.equal(typeof parsed?.deploymentId, "string");
  assert.equal(typeof parsed?.swVersion, "string");
  assert.match(parsed?.swVersion || "", /^kbestie-shell-/);
  assert.equal(parsed?.serviceWorkerScriptUrl, "/sw.js");
});

test("GET returns 503 when server build metadata is missing or corrupted", async () => {
  const deps: ClientVersionGetDeps = {
    getDeploymentInfo: () => ({
      buildId: "",
      buildStamp: "",
      deploymentId: "",
      swVersion: "",
      serviceWorkerScriptUrl: "",
    }),
  };

  const response = await GET(deps);
  assert.equal(response.status, 503);
  const json = await response.json();
  assert.deepEqual(json, { error: "Build metadata missing" });
});

test("isValidJsonContentType accepts application/json with no params or valid balanced double-quote charset and rejects single quotes / unbalanced / invalid", () => {
  // Valid
  assert.equal(isValidJsonContentType("application/json"), true);
  assert.equal(isValidJsonContentType("application/json; charset=utf-8"), true);
  assert.equal(isValidJsonContentType("application/json; charset=utf8"), true);
  assert.equal(isValidJsonContentType("application/json; charset=UTF-8"), true);
  assert.equal(isValidJsonContentType("application/json; charset=\"utf-8\""), true);
  assert.equal(isValidJsonContentType("application/json; charset=\"UTF-8\""), true);
  assert.equal(isValidJsonContentType("application/json; charset=\"utf8\""), true);
  assert.equal(isValidJsonContentType("APPLICATION/JSON"), true);

  // Invalid / rejected
  assert.equal(isValidJsonContentType(null), false);
  assert.equal(isValidJsonContentType(""), false);
  assert.equal(isValidJsonContentType("text/plain"), false);
  assert.equal(isValidJsonContentType("text/application/json"), false);
  assert.equal(isValidJsonContentType("application/jsonx"), false);
  assert.equal(isValidJsonContentType("application/json; charset='utf-8'"), false); // single quote rejected
  assert.equal(isValidJsonContentType("application/json; charset='utf8'"), false); // single quote rejected
  assert.equal(isValidJsonContentType("application/json; charset=\"utf-8"), false); // unbalanced
  assert.equal(isValidJsonContentType("application/json; charset=utf-8\""), false); // unbalanced
  assert.equal(isValidJsonContentType("application/json; charset='utf-8\""), false); // mismatched
  assert.equal(isValidJsonContentType("application/json; charset=\"utf-8'"), false); // mismatched
  assert.equal(isValidJsonContentType("application/json; charset=iso-8859-1"), false);
  assert.equal(isValidJsonContentType("application/json; boundary=something"), false);
  assert.equal(isValidJsonContentType("application/json; charset=utf-8; foo=bar"), false);
  assert.equal(isValidJsonContentType("application/json; charset="), false);
  assert.equal(isValidJsonContentType("application/json; charset= "), false);
  assert.equal(isValidJsonContentType("application/json; charset=\"\""), false);
  assert.equal(isValidJsonContentType("application/json; charset=\"utf-8 \""), false); // untrimmed inside quotes rejected
  assert.equal(isValidJsonContentType("application/json; charset=\" utf-8\""), false); // untrimmed inside quotes rejected
});

test("isGenuineNoSessionAuthError in client-version route differentiates genuine unauthenticated from upstream auth failures and DB errors", () => {
  // Genuine no session / explicit allowlist
  assert.equal(isGenuineNoSessionAuthError(null), true);
  assert.equal(isGenuineNoSessionAuthError(undefined), true);
  assert.equal(isGenuineNoSessionAuthError({ status: 400, name: "AuthSessionMissingError", message: "Auth session missing!" }), true);
  assert.equal(isGenuineNoSessionAuthError({ status: 401, code: "bad_jwt", message: "Invalid JWT" }), true);
  assert.equal(isGenuineNoSessionAuthError({ status: 401, code: "jwt_expired", message: "JWT expired" }), true);
  assert.equal(isGenuineNoSessionAuthError({ status: 401, code: "invalid_credentials" }), true);
  assert.equal(isGenuineNoSessionAuthError({ status: 401, name: "AuthInvalidCredentialsError" }), true);
  assert.equal(isGenuineNoSessionAuthError({ status: 400, code: "session_not_found" }), true);

  // Upstream 400 or DB errors (must fail 500)
  assert.equal(isGenuineNoSessionAuthError({ status: 400, message: "relation auth.users not found" }), false);
  assert.equal(isGenuineNoSessionAuthError({ status: 400, message: "invalid upstream response" }), false);
  assert.equal(isGenuineNoSessionAuthError({ status: 400, message: "database connection lost" }), false);
  assert.equal(isGenuineNoSessionAuthError({ status: 401, message: "Invalid JWT token" }), false); // without explicit code/name
  assert.equal(isGenuineNoSessionAuthError({ status: 401, message: "unknown authentication error" }), false);

  // Auth service errors / non-400/401 status (must fail 500)
  assert.equal(isGenuineNoSessionAuthError({ status: 429, message: "Rate limit exceeded" }), false);
  assert.equal(isGenuineNoSessionAuthError({ status: 500, message: "Internal server error" }), false);
  assert.equal(isGenuineNoSessionAuthError({ status: 503, message: "Service unavailable" }), false);
  assert.equal(isGenuineNoSessionAuthError({ message: "Network connection refused" }), false);
});

test("readJsonStreamWithLimit enforces 2KB size limit for client-version POST, cancels reader, and fails closed", async () => {
  // 1. Valid small JSON
  const validJson = JSON.stringify({ sessionId: "12345678-1234-4234-8234-123456789abc" });
  const req1 = createStreamRequest(validJson);
  const res1 = await readJsonStreamWithLimit(req1, 2048);
  assert.equal(res1.ok, true);
  if (res1.ok) {
    assert.deepEqual(res1.data, {
      sessionId: "12345678-1234-4234-8234-123456789abc",
    });
  }

  // 2. Oversized payload (> 2048 bytes) with cancel spy
  let cancelCalled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2500).fill(65));
    },
    cancel() {
      cancelCalled = true;
    },
  });

  const req2 = new Request("https://app.k-bestie.com/api/client-version", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInitWithDuplex);

  const res2 = await readJsonStreamWithLimit(req2, 2048);
  assert.equal(res2.ok, false);
  if (!res2.ok) {
    assert.equal(res2.status, 413);
  }
  assert.equal(cancelCalled, true, "Reader must be canceled on 413");
});

test("POST returns 415 on invalid Content-Type", async () => {
  const req = createStreamRequest(JSON.stringify({ swVersion: "v1" }), {
    "content-type": "text/plain",
  });
  const res = await POST(req);
  assert.equal(res.status, 415);
});

test("POST returns 413 when payload exceeds 2KB", async () => {
  const bigData = JSON.stringify({
    swVersion: "x".repeat(3000),
  });
  const req = createStreamRequest(bigData);
  const res = await POST(req);
  assert.equal(res.status, 413);
});

test("POST returns 400 on malformed JSON, forbidden childId, invalid UUID or unknown fields", async () => {
  // 1. Malformed JSON
  const req1 = createStreamRequest("{ invalid_json: ");
  const res1 = await POST(req1);
  assert.equal(res1.status, 400);

  // 2. Forbidden childId provided by client
  const req2 = createStreamRequest(
    JSON.stringify({ childId: "12345678-1234-4234-8234-123456789abc" }),
  );
  const res2 = await POST(req2);
  assert.equal(res2.status, 400);

  // 3. Invalid sessionId UUID
  const req3 = createStreamRequest(JSON.stringify({ sessionId: "not-a-uuid" }));
  const res3 = await POST(req3);
  assert.equal(res3.status, 400);

  // 4. Unknown field
  const req4 = createStreamRequest(
    JSON.stringify({ unknown_field: "attacker_payload" }),
  );
  const res4 = await POST(req4);
  assert.equal(res4.status, 400);
});

test("POST returns 401 when user is genuinely unauthenticated", async () => {
  // Case A: user is null, error is null
  const req1 = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps1: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    }),
  };
  const res1 = await POST(req1, deps1);
  assert.equal(res1.status, 401);

  // Case B: auth error with 401 invalid token code
  const req2 = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps2: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { status: 401, code: "bad_jwt", message: "Invalid JWT token" },
        }),
      },
    }),
  };
  const res2 = await POST(req2, deps2);
  assert.equal(res2.status, 401);
});

test("POST returns 500 on auth service upstream errors (429, missing status, 5xx, or exception)", async () => {
  let insertCalled = false;

  // Case A: 429 rate limit from auth
  const req1 = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps1: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { status: 429, message: "Too many auth requests" },
        }),
      },
    }),
    createDbClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => {
          insertCalled = true;
          return { error: null };
        },
      }),
    }),
  };
  const res1 = await POST(req1, deps1);
  assert.equal(res1.status, 500);
  assert.equal(insertCalled, false, "Insert must not occur on auth 500");

  // Case B: missing status / network error
  const req2 = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps2: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { message: "Auth network failure" },
        }),
      },
    }),
    createDbClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => {
          insertCalled = true;
          return { error: null };
        },
      }),
    }),
  };
  const res2 = await POST(req2, deps2);
  assert.equal(res2.status, 500);
  assert.equal(insertCalled, false);

  // Case C: Auth client throws
  const req3 = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps3: ClientVersionPostDeps = {
    createAuthClient: async () => {
      throw new Error("Supabase auth crash");
    },
    createDbClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => {
          insertCalled = true;
          return { error: null };
        },
      }),
    }),
  };
  const res3 = await POST(req3, deps3);
  assert.equal(res3.status, 500);
  assert.equal(insertCalled, false);

  // Case D: status 400 DB error / relation not found
  const req4 = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps4: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { status: 400, message: "relation auth.users not found" },
        }),
      },
    }),
    createDbClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => {
          insertCalled = true;
          return { error: null };
        },
      }),
    }),
  };
  const res4 = await POST(req4, deps4);
  assert.equal(res4.status, 500);
  assert.equal(insertCalled, false);

  // Case E: status 400 invalid upstream response
  const req5 = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps5: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { status: 400, message: "invalid upstream response" },
        }),
      },
    }),
    createDbClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => {
          insertCalled = true;
          return { error: null };
        },
      }),
    }),
  };
  const res5 = await POST(req5, deps5);
  assert.equal(res5.status, 500);
  assert.equal(insertCalled, false);

  // Case F: status 401 with unknown code/name
  const req6 = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps6: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { status: 401, message: "unknown error without code or name" },
        }),
      },
    }),
    createDbClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => {
          insertCalled = true;
          return { error: null };
        },
      }),
    }),
  };
  const res6 = await POST(req6, deps6);
  assert.equal(res6.status, 500);
  assert.equal(insertCalled, false);
});

test("POST returns 403 when actor is not eligible", async () => {
  const req = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    }),
    resolveActor: async () => {
      throw new AppSessionError("Not a child user", "not_eligible");
    },
  };

  const res = await POST(req, deps);
  assert.equal(res.status, 403);
});

test("POST returns 500 when actor resolution encounters DB error", async () => {
  const req = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    }),
    resolveActor: async () => {
      throw new AppSessionError("DB down", "database_error");
    },
  };

  const res = await POST(req, deps);
  assert.equal(res.status, 500);
});

test("POST returns 500 fail-closed when session verification DB lookup fails", async () => {
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const req = createStreamRequest(JSON.stringify({ sessionId, swVersion: "kbestie-shell-v1" }));
  let insertCalled = false;

  const deps: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: "DB read error" },
            }),
          }),
        }),
        insert: async () => {
          insertCalled = true;
          return { error: null };
        },
      }),
    }),
  };

  const res = await POST(req, deps);
  assert.equal(res.status, 500);
  assert.equal(insertCalled, false, "Insert must not occur if session verification fails with DB error");
});

test("POST returns 403 when session is not found or does not belong to actor", async () => {
  const sessionId = "44444444-4444-4444-8444-444444444444";

  // Case 1: Session not found
  const req1 = createStreamRequest(JSON.stringify({ sessionId }));
  const deps1: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert: async () => ({ error: null }),
      }),
    }),
  };

  const res1 = await POST(req1, deps1);
  assert.equal(res1.status, 403);
  const json1 = await res1.json();
  assert.deepEqual(json1, { error: "Session not found" });

  // Case 2: Session ownership mismatch
  const req2 = createStreamRequest(JSON.stringify({ sessionId }));
  const deps2: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: sessionId, child_id: "different-child-id" },
              error: null,
            }),
          }),
        }),
        insert: async () => ({ error: null }),
      }),
    }),
  };

  const res2 = await POST(req2, deps2);
  assert.equal(res2.status, 403);
  const json2 = await res2.json();
  assert.deepEqual(json2, { error: "Session ownership mismatch" });
});

test("POST returns 429 when client-version rate limit is exceeded", async () => {
  let now = 1000000;

  const deps: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-rate" } }, error: null }),
      },
    }),
    resolveActor: async () => ({ ...MOCK_ACTOR, actorId: "actor-rate-limit-test" }),
    createDbClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => ({ error: null }),
      }),
    }),
    now: () => now,
  };

  // Send 60 requests -> all 200
  for (let i = 0; i < 60; i++) {
    const req = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
    const res = await POST(req, deps);
    assert.equal(res.status, 200);
  }

  // 61st request in same minute -> 429
  const reqExceeded = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const resExceeded = await POST(reqExceeded, deps);
  assert.equal(resExceeded.status, 429);
});

test("POST returns 500 when insert into client_version_events fails", async () => {
  const req = createStreamRequest(JSON.stringify({ swVersion: "kbestie-shell-v1" }));
  const deps: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => ({ error: { message: "Insert failure" } }),
      }),
    }),
  };

  const res = await POST(req, deps);
  assert.equal(res.status, 500);
});

test("POST returns 200 on successful event insertion with session ownership verification", async () => {
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const req = createStreamRequest(
    JSON.stringify({
      sessionId,
      clientSha: "sha-123456",
      swVersion: "kbestie-shell-v2",
    }),
  );

  let insertedRecord: Record<string, unknown> | null = null;

  const deps: ClientVersionPostDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: sessionId, child_id: MOCK_ACTOR.childId },
              error: null,
            }),
          }),
        }),
        insert: async (record: Record<string, unknown>) => {
          insertedRecord = record;
          return { error: null };
        },
      }),
    }),
  };

  const res = await POST(req, deps);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, { ok: true });

  assert.notEqual(insertedRecord, null);
  assert.equal(insertedRecord?.session_id, sessionId);
  assert.equal(insertedRecord?.child_id, MOCK_ACTOR.childId);
  assert.equal(insertedRecord?.client_sha, "sha-123456");
  assert.equal(insertedRecord?.sw_version, "kbestie-shell-v2");
});
