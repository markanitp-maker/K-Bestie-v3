import test from "node:test";
import assert from "node:assert/strict";
import {
  POST,
  PwaUpdateRouteDeps,
} from "./route.js";
import {
  isValidJsonContentType,
  isGenuineNoSessionAuthError,
  readJsonStreamWithLimit,
} from "./routeInternals.js";
import { AppSessionError } from "../../../../lib/analytics/appSession.js";
import { generateDeterministicEventId } from "../../../../lib/analytics/deterministicEventId.js";
import type { BehaviorEventInput } from "../../../../lib/analytics/logBehaviorEvent.js";

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

  return new Request("https://app.k-bestie.com/api/analytics/pwa-update", init);
}

function createChunkedStreamRequest(
  chunks: Uint8Array[],
  headers: Record<string, string> = { "content-type": "application/json" },
): Request {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
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

  return new Request("https://app.k-bestie.com/api/analytics/pwa-update", init);
}

const VALID_TELEMETRY_BODY = {
  event_id: "11111111-2222-4333-8444-555555555555",
  event_type: "pwa_update_success",
  correlation_id: "22222222-3333-4444-8555-666666666666",
  route: "/child/home",
  current_version: "kbestie-shell-v1",
  latest_version: "kbestie-shell-v2",
  error_code: null,
  metadata: {
    sw_state: "installed",
    trigger: "mount_ready",
    retry_count: 1,
  },
};

const MOCK_ACTOR = {
  actorId: "actor-11111111-1111-4111-8111-111111111111",
  actorType: "child" as const,
  familyId: "family-22222222-2222-4222-8222-222222222222",
  childId: "actor-11111111-1111-4111-8111-111111111111",
};

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
  assert.equal(isValidJsonContentType("application/json, text/plain"), false);
});

test("isGenuineNoSessionAuthError differentiates genuine unauthenticated from upstream auth failures and DB errors", () => {
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
  assert.equal(isGenuineNoSessionAuthError({ message: "Network connection refused" }), false); // missing status
});

test("readJsonStreamWithLimit enforces 4KB size limit, cancels reader on overflow, and fails closed", async () => {
  // 1. Valid small JSON
  const validJson = JSON.stringify({ event_id: "test", val: 123 });
  const req1 = createStreamRequest(validJson);
  const res1 = await readJsonStreamWithLimit(req1, 4096);
  assert.equal(res1.ok, true);
  if (res1.ok) {
    assert.deepEqual(res1.data, { event_id: "test", val: 123 });
  }

  // 2. Oversized payload (> 4096 bytes) with cancel spy
  let cancelCalled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(3000).fill(65));
      controller.enqueue(new Uint8Array(2000).fill(66));
    },
    cancel() {
      cancelCalled = true;
    },
  });

  const req2 = new Request("https://app.k-bestie.com/api/analytics/pwa-update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInitWithDuplex);

  const res2 = await readJsonStreamWithLimit(req2, 4096);
  assert.equal(res2.ok, false);
  if (!res2.ok) {
    assert.equal(res2.status, 413);
  }
  assert.equal(cancelCalled, true, "Reader cancel must be invoked when exceeding limit");

  // 3. Multi-chunk payload crossing 4KB boundary
  const chunk1 = new Uint8Array(3000).fill(65);
  const chunk2 = new Uint8Array(2000).fill(66);
  const req3 = createChunkedStreamRequest([chunk1, chunk2]);
  const res3 = await readJsonStreamWithLimit(req3, 4096);
  assert.equal(res3.ok, false);
  if (!res3.ok) {
    assert.equal(res3.status, 413);
  }

  // 4. Empty request body
  const emptyReq = new Request("https://app.k-bestie.com/api/analytics/pwa-update", {
    method: "POST",
  });
  const res4 = await readJsonStreamWithLimit(emptyReq, 4096);
  assert.equal(res4.ok, false);
  if (!res4.ok) {
    assert.equal(res4.status, 400);
  }
});

test("POST returns 415 on invalid Content-Type", async () => {
  const req = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY), {
    "content-type": "text/plain",
  });
  const res = await POST(req);
  assert.equal(res.status, 415);
});

test("POST returns 413 when stream exceeds 4KB", async () => {
  const largeData = JSON.stringify({
    ...VALID_TELEMETRY_BODY,
    extra: "x".repeat(5000),
  });
  const req = createStreamRequest(largeData);
  const res = await POST(req);
  assert.equal(res.status, 413);
});

test("POST returns 400 on malformed JSON or schema/security violations", async () => {
  // 1. Malformed JSON
  const req1 = createStreamRequest("{ malformed_json: ");
  const res1 = await POST(req1);
  assert.equal(res1.status, 400);

  // 2. Missing required fields
  const req2 = createStreamRequest(JSON.stringify({ route: "/child/home" }));
  const res2 = await POST(req2);
  assert.equal(res2.status, 400);

  // 3. Spoofed identity field
  const req3 = createStreamRequest(
    JSON.stringify({
      ...VALID_TELEMETRY_BODY,
      user_id: "spoofed-user-id",
    }),
  );
  const res3 = await POST(req3);
  assert.equal(res3.status, 400);

  // 4. Invalid non-canonical route
  const req4 = createStreamRequest(
    JSON.stringify({
      ...VALID_TELEMETRY_BODY,
      route: "/child//home",
    }),
  );
  const res4 = await POST(req4);
  assert.equal(res4.status, 400);

  // 5. Invalid error_code enum
  const req5 = createStreamRequest(
    JSON.stringify({
      ...VALID_TELEMETRY_BODY,
      error_code: "unrecognized_error_code",
    }),
  );
  const res5 = await POST(req5);
  assert.equal(res5.status, 400);

  // 6. Invalid metadata enum
  const req6 = createStreamRequest(
    JSON.stringify({
      ...VALID_TELEMETRY_BODY,
      metadata: { sw_state: "fake_state" },
    }),
  );
  const res6 = await POST(req6);
  assert.equal(res6.status, 400);

  // 7. Conflicting top-level and metadata error_code
  const req7 = createStreamRequest(
    JSON.stringify({
      ...VALID_TELEMETRY_BODY,
      error_code: "network_error",
      metadata: { error_code: "install_timeout" },
    }),
  );
  const res7 = await POST(req7);
  assert.equal(res7.status, 400);
});

test("POST returns 401 when user is genuinely unauthenticated", async () => {
  // Case A: user is null, error is null
  const req1 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps1: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    }),
  };
  const res1 = await POST(req1, deps1);
  assert.equal(res1.status, 401);

  // Case B: auth error with 401 invalid token code
  const req2 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps2: PwaUpdateRouteDeps = {
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

test("POST returns 500 when auth service encounters upstream error (429, missing status, 5xx, or exception)", async () => {
  let insertCalled = false;

  // Case A: 429 rate limit
  const req1 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps1: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { status: 429, message: "Too many requests to auth" },
        }),
      },
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };
  const res1 = await POST(req1, deps1);
  assert.equal(res1.status, 500);
  assert.equal(insertCalled, false, "Insert must not be called on auth 500");

  // Case B: missing status / network error
  const req2 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps2: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { message: "Auth connection timeout" },
        }),
      },
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };
  const res2 = await POST(req2, deps2);
  assert.equal(res2.status, 500);
  assert.equal(insertCalled, false);

  // Case C: Auth client throws
  const req3 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps3: PwaUpdateRouteDeps = {
    createAuthClient: async () => {
      throw new Error("Supabase auth crash");
    },
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };
  const res3 = await POST(req3, deps3);
  assert.equal(res3.status, 500);
  assert.equal(insertCalled, false);

  // Case D: status 400 DB error / relation not found
  const req4 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps4: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { status: 400, message: "relation auth.users not found" },
        }),
      },
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };
  const res4 = await POST(req4, deps4);
  assert.equal(res4.status, 500);
  assert.equal(insertCalled, false);

  // Case E: status 400 invalid upstream response
  const req5 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps5: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { status: 400, message: "invalid upstream response" },
        }),
      },
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };
  const res5 = await POST(req5, deps5);
  assert.equal(res5.status, 500);
  assert.equal(insertCalled, false);

  // Case F: status 401 with unknown code/name
  const req6 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps6: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { status: 401, message: "unknown error without code or name" },
        }),
      },
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };
  const res6 = await POST(req6, deps6);
  assert.equal(res6.status, 500);
  assert.equal(insertCalled, false);
});

test("POST returns 403 when actor is not eligible", async () => {
  const req = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    }),
    resolveActor: async () => {
      throw new AppSessionError("Child profile not found", "not_eligible");
    },
  };

  const res = await POST(req, deps);
  assert.equal(res.status, 403);
});

test("POST returns 500 when actor resolution encounters DB error", async () => {
  const req = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps: PwaUpdateRouteDeps = {
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

test("POST returns 500 fail-closed when existing row lookup fails or throws", async () => {
  let insertCalled = false;

  // Case A: maybeSingle returns error
  const req1 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps1: PwaUpdateRouteDeps = {
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
            eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
          }),
        }),
      }),
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };

  const res1 = await POST(req1, deps1);
  assert.equal(res1.status, 500);
  assert.equal(insertCalled, false, "Insert must NOT be called if lookup fails");

  // Case B: maybeSingle throws
  const req2 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps2: PwaUpdateRouteDeps = {
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
            maybeSingle: async () => {
              throw new Error("DB connection crash");
            },
            eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
          }),
        }),
      }),
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };

  const res2 = await POST(req2, deps2);
  assert.equal(res2.status, 500);
  assert.equal(insertCalled, false);
});

test("POST returns 200 duplicate when matching event already exists and does not consume rate limit", async () => {
  const req = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deterministicId = generateDeterministicEventId(
    MOCK_ACTOR.actorId,
    VALID_TELEMETRY_BODY.event_id,
  );
  let insertCalled = false;

  const deps: PwaUpdateRouteDeps = {
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
              data: {
                id: deterministicId,
                actor_id: MOCK_ACTOR.actorId,
                event_name: VALID_TELEMETRY_BODY.event_type,
                properties: { client_event_id: VALID_TELEMETRY_BODY.event_id },
              },
              error: null,
            }),
            eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
          }),
        }),
      }),
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };

  const res = await POST(req, deps);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, { ok: true, duplicate: true });
  assert.equal(insertCalled, false, "Insert must not be called on existing duplicate");
});

test("POST returns 409 conflict when existing row ID collides with different identity/event", async () => {
  const req = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deterministicId = generateDeterministicEventId(
    MOCK_ACTOR.actorId,
    VALID_TELEMETRY_BODY.event_id,
  );
  let insertCalled = false;

  const deps: PwaUpdateRouteDeps = {
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
              data: {
                id: deterministicId,
                actor_id: "different-actor-id",
                event_name: "other_event",
                properties: { client_event_id: "different-client-event-id" },
              },
              error: null,
            }),
            eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
          }),
        }),
      }),
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };

  const res = await POST(req, deps);
  assert.equal(res.status, 409);
  assert.equal(insertCalled, false, "Insert must not be called on ID collision");
});

test("POST returns 500 fail-closed when rolling count DB query fails or throws", async () => {
  let insertCalled = false;

  // Case A: count returns error
  const req1 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps1: PwaUpdateRouteDeps = {
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
        select: (cols: string, opts?: Record<string, unknown>) => ({
          eq: (col: string) => {
            if (opts?.count === "exact") {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
                eq: () => ({
                  gte: async () => ({ count: null, error: { message: "Count error" } }),
                }),
              };
            }
            return {
              maybeSingle: async () => ({ data: null, error: null }),
              eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
            };
          },
        }),
      }),
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };

  const res1 = await POST(req1, deps1);
  assert.equal(res1.status, 500);
  assert.equal(insertCalled, false, "Insert must not be called when rolling count fails");

  // Case B: count throws
  const req2 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps2: PwaUpdateRouteDeps = {
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
        select: (cols: string, opts?: Record<string, unknown>) => ({
          eq: (col: string) => {
            if (opts?.count === "exact") {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
                eq: () => ({
                  gte: async () => {
                    throw new Error("Count query crash");
                  },
                }),
              };
            }
            return {
              maybeSingle: async () => ({ data: null, error: null }),
              eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
            };
          },
        }),
      }),
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };

  const res2 = await POST(req2, deps2);
  assert.equal(res2.status, 500);
  assert.equal(insertCalled, false);
});

test("POST returns 429 when rolling DB rate limit is exceeded", async () => {
  const req = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  let insertCalled = false;

  const deps: PwaUpdateRouteDeps = {
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
        select: (cols: string, opts?: Record<string, unknown>) => ({
          eq: () => {
            if (opts?.count === "exact") {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
                eq: () => ({
                  gte: async () => ({ count: 65, error: null }),
                }),
              };
            }
            return {
              maybeSingle: async () => ({ data: null, error: null }),
              eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
            };
          },
        }),
      }),
    }),
    logEvent: async () => {
      insertCalled = true;
      return "inserted";
    },
  };

  const res = await POST(req, deps);
  assert.equal(res.status, 429);
  assert.equal(insertCalled, false, "Insert must not be called when rate limit exceeded");
});

test("POST enforces burst rate quota separately and fails closed with 429 after 10 requests in 10s", async () => {
  const burstActor = {
    actorId: "actor-burst-test-unique-id",
    actorType: "child" as const,
    familyId: "family-burst",
    childId: "child-burst",
  };
  let insertCount = 0;
  const now = 5000000;

  const deps: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-burst" } },
          error: null,
        }),
      },
    }),
    resolveActor: async () => burstActor,
    createDbClient: () => ({
      from: () => ({
        select: (cols: string, opts?: Record<string, unknown>) => ({
          eq: () => {
            if (opts?.count === "exact") {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
                eq: () => ({
                  gte: async () => ({ count: 0, error: null }), // Low DB count
                }),
              };
            }
            return {
              maybeSingle: async () => ({ data: null, error: null }),
              eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
            };
          },
        }),
      }),
    }),
    logEvent: async () => {
      insertCount++;
      return "inserted";
    },
    now: () => now,
  };

  // 10 requests succeed
  for (let i = 0; i < 10; i++) {
    const req = createStreamRequest(
      JSON.stringify({
        ...VALID_TELEMETRY_BODY,
        event_id: `e0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      }),
    );
    const res = await POST(req, deps);
    assert.equal(res.status, 200);
  }
  assert.equal(insertCount, 10);

  // 11th request in same window fails with 429 burst limit
  const req11 = createStreamRequest(
    JSON.stringify({
      ...VALID_TELEMETRY_BODY,
      event_id: "e0000000-0000-4000-8000-000000000011",
    }),
  );
  const res11 = await POST(req11, deps);
  assert.equal(res11.status, 429);
  assert.equal(insertCount, 10, "11th burst request must NOT trigger downstream insert");
});

test("POST returns 500 when logger fails or throws", async () => {
  // Case A: logger returns "failed"
  const req1 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps1: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: (cols: string, opts?: Record<string, unknown>) => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
          }),
        }),
      }),
    }),
    logEvent: async () => "failed",
  };
  const res1 = await POST(req1, deps1);
  assert.equal(res1.status, 500);

  // Case B: logger throws
  const req2 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  const deps2: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: (cols: string, opts?: Record<string, unknown>) => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
          }),
        }),
      }),
    }),
    logEvent: async () => {
      throw new Error("Logger unexpected crash");
    },
  };
  const res2 = await POST(req2, deps2);
  assert.equal(res2.status, 500);
});

test("POST handles 23505 race condition: fails 500 on re-read error, 409 on collision, and 200 on exact match", async () => {
  const deterministicId = generateDeterministicEventId(
    MOCK_ACTOR.actorId,
    VALID_TELEMETRY_BODY.event_id,
  );

  // Case A: re-read fails with DB error -> 500
  const req1 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  let lookupCount1 = 0;
  const deps1: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: (cols: string, opts?: Record<string, unknown>) => ({
          eq: () => {
            if (opts?.count === "exact") {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
                eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
              };
            }
            lookupCount1++;
            return {
              maybeSingle: async () => {
                if (lookupCount1 === 1) return { data: null, error: null };
                return { data: null, error: { message: "Re-read failed" } };
              },
              eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
            };
          },
        }),
      }),
    }),
    logEvent: async () => "duplicate",
  };
  const res1 = await POST(req1, deps1);
  assert.equal(res1.status, 500);

  // Case B: re-read returns row with mismatched properties -> 409
  const req2 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  let lookupCount2 = 0;
  const deps2: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: (cols: string, opts?: Record<string, unknown>) => ({
          eq: () => {
            if (opts?.count === "exact") {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
                eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
              };
            }
            lookupCount2++;
            return {
              maybeSingle: async () => {
                if (lookupCount2 === 1) return { data: null, error: null };
                return {
                  data: {
                    id: deterministicId,
                    actor_id: MOCK_ACTOR.actorId,
                    event_name: VALID_TELEMETRY_BODY.event_type,
                    properties: { client_event_id: "other-client-id" }, // mismatch
                  },
                  error: null,
                };
              },
              eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
            };
          },
        }),
      }),
    }),
    logEvent: async () => "duplicate",
  };
  const res2 = await POST(req2, deps2);
  assert.equal(res2.status, 409);

  // Case C: re-read returns matching row -> 200 duplicate
  const req3 = createStreamRequest(JSON.stringify(VALID_TELEMETRY_BODY));
  let lookupCount3 = 0;
  const deps3: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: (cols: string, opts?: Record<string, unknown>) => ({
          eq: () => {
            if (opts?.count === "exact") {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
                eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
              };
            }
            lookupCount3++;
            return {
              maybeSingle: async () => {
                if (lookupCount3 === 1) return { data: null, error: null };
                return {
                  data: {
                    id: deterministicId,
                    actor_id: MOCK_ACTOR.actorId,
                    event_name: VALID_TELEMETRY_BODY.event_type,
                    properties: { client_event_id: VALID_TELEMETRY_BODY.event_id },
                  },
                  error: null,
                };
              },
              eq: () => ({ gte: async () => ({ count: 0, error: null }) }),
            };
          },
        }),
      }),
    }),
    logEvent: async () => "duplicate",
  };
  const res3 = await POST(req3, deps3);
  assert.equal(res3.status, 200);
  const json3 = await res3.json();
  assert.deepEqual(json3, { ok: true, duplicate: true });
});

test("POST preserves top-level error_code authority in logged properties", async () => {
  const req = createStreamRequest(
    JSON.stringify({
      ...VALID_TELEMETRY_BODY,
      error_code: "network_error",
      metadata: {
        sw_state: "installed",
        trigger: "mount_ready",
        error_code: "network_error", // matching
      },
    }),
  );
  let loggedPayload: BehaviorEventInput | null = null;

  const deps: PwaUpdateRouteDeps = {
    createAuthClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
      },
    }),
    resolveActor: async () => MOCK_ACTOR,
    createDbClient: () => ({
      from: () => ({
        select: (cols: string, opts?: Record<string, unknown>) => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            eq: () => ({ gte: async () => ({ count: 5, error: null }) }),
          }),
        }),
      }),
    }),
    logEvent: async (input: BehaviorEventInput) => {
      loggedPayload = input;
      return "inserted";
    },
  };

  const res = await POST(req, deps);
  assert.equal(res.status, 200);
  assert.notEqual(loggedPayload, null);
  assert.equal(loggedPayload?.feature, "pwa_update");
  assert.equal(loggedPayload?.eventName, "pwa_update_success");
  assert.equal(loggedPayload?.actorId, MOCK_ACTOR.actorId);
  assert.equal(loggedPayload?.properties?.error_code, "network_error");
});
