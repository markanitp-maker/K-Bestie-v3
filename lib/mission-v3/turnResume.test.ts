import test from "node:test";
import assert from "node:assert/strict";
import {
  MISSION_TURN_INFLIGHT_WINDOW_MS,
  fetchResumableMissionTurn,
  isResumableStuckTurn,
  type MissionTurnResumeRecord,
} from "./routeSupport";

// 2026-08-16 안서현 Production 장애 재현 기준값.
const NOW = Date.parse("2026-08-16T02:00:00.000Z");
const stale = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** 실제 stuck turn 형태: 아이 발화만 저장되고 K 응답이 하나도 없다. */
const stuckTurn = (overrides: Partial<MissionTurnResumeRecord> = {}): MissionTurnResumeRecord => ({
  status: "CHILD_PERSISTED",
  child_message_id: "b1a3f0f2-0000-4000-8000-000000000001",
  k_message_id: null,
  k_response_draft: null,
  updated_at: stale(MISSION_TURN_INFLIGHT_WINDOW_MS + 1000),
  ...overrides,
});

test("in-flight 창을 넘긴 CHILD_PERSISTED 턴은 이어서 처리한다", () => {
  assert.equal(isResumableStuckTurn(stuckTurn(), NOW), true);
});

test("안서현 케이스(수 시간 방치)도 이어서 처리한다", () => {
  const record = stuckTurn({ updated_at: "2026-08-16T00:49:20.178885Z" });
  assert.equal(isResumableStuckTurn(record, NOW), true);
});

test("창 안에 있으면 실제 처리 중일 수 있으므로 이어받지 않는다", () => {
  assert.equal(
    isResumableStuckTurn(stuckTurn({ updated_at: stale(MISSION_TURN_INFLIGHT_WINDOW_MS - 1000) }), NOW),
    false,
  );
  // 경계값: 정확히 창 길이면 이미 죽은 것으로 본다(RPC의 > 비교와 반대편).
  assert.equal(
    isResumableStuckTurn(stuckTurn({ updated_at: stale(MISSION_TURN_INFLIGHT_WINDOW_MS) }), NOW),
    true,
  );
});

test("K 응답이 이미 있으면 고착이 아니다(재생·이어받기 경로)", () => {
  assert.equal(isResumableStuckTurn(stuckTurn({ k_response_draft: "오, 그랬구나!" }), NOW), false);
  assert.equal(
    isResumableStuckTurn(stuckTurn({ k_message_id: "c2b4f0f2-0000-4000-8000-000000000002" }), NOW),
    false,
  );
});

test("CHILD_PERSISTED가 아닌 상태는 이어받지 않는다", () => {
  for (const status of ["FINALIZED", "ANSWER_PROCESSED", "SAFETY_PAUSED", null, undefined]) {
    assert.equal(
      isResumableStuckTurn(stuckTurn({ status: status as string | null }), NOW),
      false,
      `status=${String(status)}`,
    );
  }
});

test("아이 발화가 없으면 이어서 처리할 대상이 없다", () => {
  assert.equal(isResumableStuckTurn(stuckTurn({ child_message_id: null }), NOW), false);
});

test("updated_at이 없거나 깨져 있으면 판정하지 않는다", () => {
  assert.equal(isResumableStuckTurn(stuckTurn({ updated_at: null }), NOW), false);
  assert.equal(isResumableStuckTurn(stuckTurn({ updated_at: "not-a-date" }), NOW), false);
});

test("레코드가 없으면 이어받지 않는다", () => {
  assert.equal(isResumableStuckTurn(null, NOW), false);
  assert.equal(isResumableStuckTurn(undefined, NOW), false);
});

// ── fetchResumableMissionTurn ────────────────────────────────────────────────

type StubResult = { data: unknown; error: { message: string } | null };

/** mission_turns 조회 체인만 흉내내는 최소 스텁. */
const stubDb = (result: StubResult, captured: { filters?: string[] } = {}) => {
  const filters: string[] = [];
  captured.filters = filters;
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "is", "not", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      filters.push(`${method}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return builder;
    };
  }
  builder.maybeSingle = async () => result;
  return { from: () => builder } as unknown as Parameters<typeof fetchResumableMissionTurn>[0];
};

test("K 응답이 없는 턴을 이어하기 정보로 돌려준다", async () => {
  const captured: { filters?: string[] } = {};
  const db = stubDb({
    data: {
      client_turn_id: "aac658db-61cf-4032-9bee-1dfecc15f95c",
      chat_messages: { content: "응?", voice_mode: "stt_tts", display_sequence: 42 },
    },
    error: null,
  }, captured);

  const resumable = await fetchResumableMissionTurn(db, "7dbd3513-c89e-4fbc-acc5-6628d8e6e3cb");
  assert.deepEqual(resumable, {
    clientTurnId: "aac658db-61cf-4032-9bee-1dfecc15f95c",
    answerText: "응?",
    voiceMode: "stt_tts",
    displaySequence: 42,
  });
  const filters = (captured.filters ?? []).join(" ");
  assert.match(filters, /neq\("status","FINALIZED"\)/, "완료된 턴은 제외해야 한다");
  assert.match(filters, /is\("k_response_draft",null\)/);
  assert.match(filters, /is\("k_message_id",null\)/);
});

test("배열로 조인된 chat_messages도 처리한다", async () => {
  const db = stubDb({
    data: {
      client_turn_id: "turn-1",
      chat_messages: [{ content: "학교 갔다 왔어", voice_mode: "live", display_sequence: 0 }],
    },
    error: null,
  });
  const resumable = await fetchResumableMissionTurn(db, "session-1");
  assert.equal(resumable?.answerText, "학교 갔다 왔어");
  assert.equal(resumable?.voiceMode, "live");
  assert.equal(resumable?.displaySequence, 0);
});

test("이어할 턴이 없으면 null이다", async () => {
  const db = stubDb({ data: null, error: null });
  assert.equal(await fetchResumableMissionTurn(db, "session-1"), null);
});

test("조회가 실패해도 미션 진입을 막지 않는다(fail-open)", async () => {
  const db = stubDb({ data: null, error: { message: "boom" } });
  assert.equal(await fetchResumableMissionTurn(db, "session-1"), null);
});

test("재전송에 필요한 값이 하나라도 없으면 이어하기를 제안하지 않는다", async () => {
  const cases = [
    { client_turn_id: null, chat_messages: { content: "응?", voice_mode: "stt_tts", display_sequence: 1 } },
    { client_turn_id: "t", chat_messages: { content: "   ", voice_mode: "stt_tts", display_sequence: 1 } },
    { client_turn_id: "t", chat_messages: { content: "응?", voice_mode: "unknown", display_sequence: 1 } },
    { client_turn_id: "t", chat_messages: { content: "응?", voice_mode: "stt_tts", display_sequence: null } },
    { client_turn_id: "t", chat_messages: null },
  ];
  for (const data of cases) {
    assert.equal(await fetchResumableMissionTurn(stubDb({ data, error: null }), "s"), null, JSON.stringify(data));
  }
});
