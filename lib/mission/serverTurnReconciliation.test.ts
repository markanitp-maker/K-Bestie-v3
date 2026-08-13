import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyServerTurnSnapshot,
  extractMissionTurnRecoveryState,
  mergeMissionStartWithTurnRecovery,
  type MissionTurnRecord,
} from "./serverTurnReconciliation";

const clientTurnId = "turn-q3";
const questionId = "q3";
const childMessage = { id: "child-message", turn_id: clientTurnId, role: "child" as const };
const kMessage = { id: "k-message", turn_id: `${clientTurnId}:k`, role: "k" as const };

function turn(overrides: Partial<MissionTurnRecord>): MissionTurnRecord {
  return {
    status: "CHILD_PERSISTED",
    question_id: questionId,
    child_message_id: childMessage.id,
    k_message_id: null,
    answer_result: null,
    ...overrides,
  };
}

test("A: child turn 서버 미저장은 not_committed로 판정한다", () => {
  const result = classifyServerTurnSnapshot({
    clientTurnId,
    questionId,
    turn: null,
    progress: { question_states: { q2: "answered", q3: "pending" } },
    messages: [],
  });
  assert.equal(result.status, "not_committed");
});

test("B: child/progress 저장 후 ACK/K finalize 실패는 committed로 판정한다", () => {
  const result = classifyServerTurnSnapshot({
    clientTurnId,
    questionId,
    turn: turn({ status: "ANSWER_PROCESSED", answer_result: { questionState: "answered" } }),
    progress: { question_states: { q2: "answered", q3: "answered" } },
    messages: [childMessage],
  });
  assert.equal(result.status, "committed");
  assert.equal(result.kCommitted, false);
});

test("C: K turn까지 저장 후 client 미수신은 committed로 판정한다", () => {
  const result = classifyServerTurnSnapshot({
    clientTurnId,
    questionId,
    turn: turn({
      status: "FINALIZED",
      answer_result: { questionState: "answered" },
      k_message_id: kMessage.id,
    }),
    progress: { question_states: { q2: "answered", q3: "answered" } },
    messages: [childMessage, kMessage],
  });
  assert.equal(result.status, "committed");
  assert.equal(result.kCommitted, true);
});

test("부분 저장 상태는 replay 대상인 unknown으로 판정한다", () => {
  const result = classifyServerTurnSnapshot({
    clientTurnId,
    questionId,
    turn: turn({}),
    progress: { question_states: { q2: "answered", q3: "pending" } },
    messages: [childMessage],
  });
  assert.equal(result.status, "unknown");
});

test("FINALIZED turn answer_result repairs stale progress for local hydration", () => {
  const recoveryState = extractMissionTurnRecoveryState({
    questionStates: { q2: "answered", q3: "answered" },
    validAnswerCount: 3,
    progressPercent: 60,
    completed: false,
    internalField: "not-exposed",
  });
  const merged = mergeMissionStartWithTurnRecovery({
    sessionId: "session-1",
    resumed: true,
    questionStates: { q2: "answered", q3: "pending" },
    validAnswerCount: 2,
    questions: ["server-start-questions"],
  }, recoveryState);

  assert.deepEqual(merged.questionStates, { q2: "answered", q3: "answered" });
  assert.equal(merged.validAnswerCount, 3);
  assert.equal(merged.progressPercent, 60);
  assert.deepEqual(merged.questions, ["server-start-questions"]);
  assert.equal("internalField" in merged, false);
});
