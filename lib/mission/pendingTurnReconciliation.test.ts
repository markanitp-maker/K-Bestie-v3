import assert from "node:assert/strict";
import test from "node:test";
import { isPendingMissionTurnExpired, PENDING_TURN_TTL_MS, type PendingMissionTurn } from "./pendingTurnStore";
import { reconcilePendingMissionTurn } from "./pendingTurnReconciliation";

const pending: PendingMissionTurn = {
  sessionId: "session-1",
  clientTurnId: "turn-q3",
  questionId: "q3",
  answerText: "답변",
  voiceMode: "stt_tts",
  displaySequence: 5,
  createdAt: 1_000,
};

test("TTL은 stale 후보만 표시하고 pending turn 자체를 판정하지 않는다", () => {
  assert.equal(isPendingMissionTurnExpired(pending, pending.createdAt + PENDING_TURN_TTL_MS), false);
  assert.equal(isPendingMissionTurnExpired(pending, pending.createdAt + PENDING_TURN_TTL_MS + 1), true);
});

test("서버에 commit된 turn은 replay 없이 성공으로 수렴한다", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      status: "committed",
      recoveryState: { questionStates: { q3: "answered" }, validAnswerCount: 3 },
    }), { status: 200 });
  }) as typeof fetch;

  const result = await reconcilePendingMissionTurn({ pending, fetchImpl });
  assert.deepEqual(result, {
    status: "committed",
    replayAttempted: false,
    recoveryState: { questionStates: { q3: "answered" }, validAnswerCount: 3 },
  });
  assert.equal(calls.length, 1);
});

test("서버에 없는 turn은 replay 없이 stale로 확정한다", async () => {
  const fetchImpl = (async () => (
    new Response(JSON.stringify({ status: "not_committed" }), { status: 200 })
  )) as typeof fetch;

  const result = await reconcilePendingMissionTurn({ pending, fetchImpl });
  assert.deepEqual(result, { status: "not_committed", replayAttempted: false, recoveryState: null });
});

test("불명확한 turn은 같은 clientTurnId로 한 번 replay한 뒤 재조회한다", async () => {
  const methods: string[] = [];
  const postedBodies: Array<Record<string, unknown>> = [];
  let getCount = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    methods.push(method);
    if (method === "POST") {
      postedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response("{}", { status: 503 });
    }
    getCount += 1;
    return new Response(JSON.stringify({ status: getCount === 1 ? "unknown" : "committed" }), { status: 200 });
  }) as typeof fetch;

  const result = await reconcilePendingMissionTurn({ pending, fetchImpl });
  assert.deepEqual(result, { status: "committed", replayAttempted: true, recoveryState: null });
  assert.deepEqual(methods, ["GET", "POST", "GET"]);
  assert.equal(postedBodies.length, 1);
  assert.equal(postedBodies[0].clientTurnId, pending.clientTurnId);
});

test("불명확한 turn의 replay가 409여도 POST는 정확히 한 번만 보낸다", async () => {
  let getCount = 0;
  let postCount = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      postCount += 1;
      return new Response("{}", { status: 409 });
    }
    getCount += 1;
    return new Response(JSON.stringify({ status: "unknown" }), { status: 200 });
  }) as typeof fetch;

  const result = await reconcilePendingMissionTurn({ pending, fetchImpl });
  assert.deepEqual(result, { status: "unknown", replayAttempted: true, recoveryState: null });
  assert.equal(postCount, 1);
  assert.equal(getCount, 2);
});
