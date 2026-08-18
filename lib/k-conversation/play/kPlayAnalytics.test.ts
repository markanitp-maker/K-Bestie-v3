import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordKPlayEvent } from "./kPlayAnalytics";

/**
 * `logEvent` 를 주입해 payload 를 들여다본다.
 *
 * `mock.module` 을 쓰면 `--experimental-test-module-mocks` 없이는 조용히 죽는다.
 * 실제로 그 상태에서 "8/8 통과"로 잘못 보고된 적이 있어 주입 방식으로 바꿨다.
 */
type Captured = Record<string, unknown>;

function makeDb(familyId: string | null = "family-1", shouldThrow = false): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (shouldThrow) throw new Error("DB down");
            return { data: familyId ? { family_id: familyId } : null, error: null };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

/** fire-and-forget 이므로 마이크로태스크가 비워질 때까지 기다린다. */
const flush = () => new Promise((r) => setImmediate(r));

function baseInput(captured: Captured[], overrides: Record<string, unknown> = {}) {
  return {
    db: makeDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    skillId: "WORD_CHAIN",
    route: "/api/play/skill/select",
    logEvent: (async (payload: Captured) => {
      captured.push(payload);
      return { ok: true } as never;
    }) as never,
    ...overrides,
  };
}

test("1. CHECK 제약 방어: play_type 을 절대 싣지 않는다", async () => {
  // behavior_events.play_type 은 ('comic_book','quiz','hairstyle','mbti') 만 허용한다.
  // 케이 놀이 값을 넣으면 insert 가 통째로 실패해 계측이 조용히 사라진다.
  const captured: Captured[] = [];
  recordKPlayEvent("k_play_start", baseInput(captured) as never);
  await flush();

  assert.equal(captured.length, 1);
  assert.equal(captured[0].playType, undefined, "playType 이 실리면 안 된다");
  assert.ok(!("play_type" in captured[0]), "play_type 키가 있으면 안 된다");
});

test("2. 게임 참여 지표를 오염시키지 않는다 — 이벤트 이름이 k_play_* 다", async () => {
  const captured: Captured[] = [];
  recordKPlayEvent("k_play_start", baseInput(captured) as never);
  recordKPlayEvent("k_play_complete", baseInput(captured, { route: "/api/play/skill/end" }) as never);
  await flush();

  const names = captured.map((c) => c.eventName);
  assert.deepEqual(names, ["k_play_start", "k_play_complete"]);
  assert.ok(
    !names.includes("play_start") && !names.includes("play_complete"),
    "게임 참여(MBTI·퀴즈마스터)가 쓰는 이름을 재사용하면 두 지표가 섞인다"
  );
});

test("3. event_key 에 스킬 id 가 담기고 feature 는 freechat 이다", async () => {
  const captured: Captured[] = [];
  recordKPlayEvent("k_play_start", baseInput(captured, { skillId: "CHOSUNG" }) as never);
  await flush();

  assert.equal(captured[0].eventKey, "CHOSUNG");
  assert.equal(captured[0].feature, "freechat");
  assert.equal(captured[0].actorType, "child");
  assert.equal(captured[0].sessionId, "chat-1");
});

test("4. 기록이 실패해도 예외가 호출자에게 새지 않는다", async () => {
  const failing = baseInput([], {
    logEvent: (async () => {
      throw new Error("insert failed");
    }) as never,
  });

  // 던지면 여기서 테스트가 깨진다. 계측 실패가 아이의 놀이를 멈추면 안 된다.
  assert.doesNotThrow(() => recordKPlayEvent("k_play_start", failing as never));
  await flush();
  await flush();
});

test("5. family_id 조회가 실패해도 기록은 남는다", async () => {
  const captured: Captured[] = [];
  recordKPlayEvent("k_play_start", baseInput(captured, { db: makeDb(null, true) }) as never);
  await flush();

  assert.equal(captured.length, 1, "familyId 를 못 구해도 기록은 남아야 한다");
  assert.equal(captured[0].familyId, undefined);
  assert.equal(captured[0].childId, "child-1");
});

test("6. 필수 식별자가 비면 아무것도 기록하지 않는다", async () => {
  const captured: Captured[] = [];
  recordKPlayEvent("k_play_start", baseInput(captured, { childId: "" }) as never);
  recordKPlayEvent("k_play_start", baseInput(captured, { chatSessionId: "" }) as never);
  recordKPlayEvent("k_play_start", baseInput(captured, { skillId: "" }) as never);
  await flush();

  assert.equal(captured.length, 0);
});
