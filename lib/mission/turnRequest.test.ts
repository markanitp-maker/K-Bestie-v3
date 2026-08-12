import assert from "node:assert/strict";
import test from "node:test";
import { postMissionTurnWithRetry } from "./turnRequest";

test("retries retryable failures with one logical turn id", async () => {
  const bodies: string[] = [];
  const attempts: string[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body));
    attempts.push(new Headers(init?.headers).get("x-mission-turn-attempt") ?? "");
    return new Response("{}", { status: bodies.length < 3 ? 503 : 200 });
  }) as typeof fetch;
  const response = await postMissionTurnWithRetry({
    body: { action: "start", clientTurnId: "turn-1" },
    baseDelayMs: 0,
    fetchImpl,
  });
  assert.equal(response.status, 200);
  assert.equal(new Set(bodies).size, 1);
  assert.deepEqual(attempts, ["1", "2", "3"]);
});

test("does not retry a non-retryable response", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("{}", { status: 400 });
  }) as typeof fetch;
  const response = await postMissionTurnWithRetry({ body: {}, baseDelayMs: 0, fetchImpl });
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
});

test("retries network errors", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls < 3) throw new TypeError("network failed");
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const response = await postMissionTurnWithRetry({ body: {}, baseDelayMs: 0, fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
});

test("retries 409 responses until the in-progress turn succeeds", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("{}", { status: calls < 4 ? 409 : 200 });
  }) as typeof fetch;

  const response = await postMissionTurnWithRetry({ body: {}, maxAttempts: 1, baseDelayMs: 0, fetchImpl });

  assert.equal(response.status, 200);
  assert.equal(calls, 4);
});

test("returns the final 409 response after the bounded polling window", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("{}", { status: 409 });
  }) as typeof fetch;

  const response = await postMissionTurnWithRetry({ body: {}, maxAttempts: 1, baseDelayMs: 0, fetchImpl });

  assert.equal(response.status, 409);
  assert.equal(calls, 9);
});
