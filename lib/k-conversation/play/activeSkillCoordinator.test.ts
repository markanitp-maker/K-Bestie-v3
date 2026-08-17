import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillModule } from "./skillTypes";
import {
  resolveActiveSkill,
} from "./activeSkillCoordinator";
import {
  isPlaySessionStale,
  PLAY_SESSION_STALE_MS,
} from "./playLifecycle";

function createMockDb(): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    update: () => chain,
    insert: () => chain,
  };
  return {
    from: () => chain,
  } as unknown as SupabaseClient;
}

test("playLifecycle: stale 판정 유틸리티 검증", () => {
  const now = 1700000000000;

  // 1. 30분 초과 -> stale
  const staleTime = new Date(now - (PLAY_SESSION_STALE_MS + 1000)).toISOString();
  assert.equal(isPlaySessionStale(staleTime, now), true, "30분 초과 갱신은 stale");

  // 2. 10분 전 -> not stale
  const freshTime = new Date(now - 10 * 60 * 1000).toISOString();
  assert.equal(isPlaySessionStale(freshTime, now), false, "10분 전 갱신은 fresh");

  // 3. updatedAt 없고 startedAt이 30분 초과 -> stale
  assert.equal(
    isPlaySessionStale(null, now, staleTime),
    true,
    "updatedAt 없어도 startedAt 기준으로 stale 판정"
  );

  // 4. 둘 다 없음 -> stale 아님 (끊지 않음)
  assert.equal(
    isPlaySessionStale(null, now, null),
    false,
    "타임스탬프 정보가 없으면 stale로 보지 않음"
  );
  assert.equal(
    isPlaySessionStale(undefined, now, undefined),
    false,
    "타임스탬프 undefined도 stale로 보지 않음"
  );
});

test("Coordinator Case 1: stale 세션 하나만 있음 → end() 호출됨, 반환 null", async () => {
  const db = createMockDb();
  const nowMs = 1700000000000;
  const staleUpdatedAt = new Date(nowMs - 35 * 60 * 1000).toISOString(); // 35분 전 (stale)

  let endCalled = false;
  let endReason: string | undefined;

  const staleSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 놀이",
    proposal: { label: "초성", shortDescription: "초성" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => ({
      id: "session-stale-1",
      updatedAt: staleUpdatedAt,
    }),
    start: async () => ({ handled: true }),
    handleTurn: async () => ({ handled: true }),
    end: async (input) => {
      endCalled = true;
      endReason = input.reason;
    },
  };

  const result = await resolveActiveSkill(db, "child-1", {
    nowMs,
    registry: [staleSkill],
    chatSessionId: "chat-1",
  });

  assert.equal(result.skill, null, "stale 세션은 Active로 인정되지 않고 null 반환");
  assert.equal(result.sessionId, null);
  assert.equal(endCalled, true, "stale 세션에 대해 end()가 호출되어야 함");
  assert.equal(endReason, "STALE_SESSION_CLEANUP");
  assert.deepEqual(result.cleaned, [{ skillId: "CHOSUNG", reason: "stale" }]);
});

test("Coordinator Case 2: Active 2개(둘 다 fresh) → 최근 것 1개 반환, 나머지 end() 호출, console.error 기록", async () => {
  const db = createMockDb();
  const nowMs = 1700000000000;
  const olderTime = new Date(nowMs - 10 * 60 * 1000).toISOString(); // 10분 전
  const newerTime = new Date(nowMs - 2 * 60 * 1000).toISOString();  // 2분 전 (더 최근)

  let chosungEndCalled = false;
  let wordChainEndCalled = false;
  const loggedErrors: string[] = [];

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args.map(String).join(" "));
  };

  try {
    const olderSkill: PlaySkillModule = {
      id: "CHOSUNG",
      displayName: "초성게임",
      childFacingDescription: "초성 놀이",
      proposal: { label: "초성", shortDescription: "초성" },
      matchesDirectRequest: () => false,
      getActiveSession: async () => ({
        id: "chosung-session-older",
        updatedAt: olderTime,
      }),
      start: async () => ({ handled: true }),
      handleTurn: async () => ({ handled: true }),
      end: async () => {
        chosungEndCalled = true;
      },
    };

    const newerSkill: PlaySkillModule = {
      id: "WORD_CHAIN",
      displayName: "끝말잇기",
      childFacingDescription: "끝말잇기 놀이",
      proposal: { label: "끝말잇기", shortDescription: "끝말잇기" },
      matchesDirectRequest: () => false,
      getActiveSession: async () => ({
        id: "wordchain-session-newer",
        updatedAt: newerTime,
      }),
      start: async () => ({ handled: true }),
      handleTurn: async () => ({ handled: true }),
      end: async () => {
        wordChainEndCalled = true;
      },
    };

    const result = await resolveActiveSkill(db, "child-multi", {
      nowMs,
      registry: [olderSkill, newerSkill],
      chatSessionId: "chat-1",
    });

    // 1. 더 최근에 갱신된 WORD_CHAIN 1개만 반환
    assert.equal(result.skill?.id, "WORD_CHAIN", "가장 최근 갱신된 세션이 선택되어야 함");
    assert.equal(result.sessionId, "wordchain-session-newer");

    // 2. 이전 세션인 CHOSUNG에 대해서만 end() 호출
    assert.equal(chosungEndCalled, true, "중복 세션(이전 것)은 end()로 정리되어야 함");
    assert.equal(wordChainEndCalled, false, "선택된 활성 세션은 end()가 호출되지 않아야 함");

    // 3. console.error로 invariant violation 기록 확인
    assert.ok(
      loggedErrors.some(
        (msg) =>
          msg.includes("invariant violation") &&
          msg.includes("CHOSUNG") &&
          msg.includes("WORD_CHAIN")
      ),
      "Cross-game guard invariant violation 로그가 기록되어야 함"
    );

    assert.deepEqual(result.cleaned, [{ skillId: "CHOSUNG", reason: "duplicate" }]);
  } finally {
    console.error = originalConsoleError;
  }
});

test("Coordinator Case 3: Active 1개 fresh → 그대로 반환, end() 호출 안 함", async () => {
  const db = createMockDb();
  const nowMs = 1700000000000;
  const freshTime = new Date(nowMs - 5 * 60 * 1000).toISOString();

  let endCalled = false;

  const freshSkill: PlaySkillModule = {
    id: "NONSENSE_QUIZ",
    displayName: "넌센스 퀴즈",
    childFacingDescription: "수수께끼 놀이",
    proposal: { label: "넌센스", shortDescription: "넌센스" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => ({
      id: "nonsense-session-1",
      updatedAt: freshTime,
    }),
    start: async () => ({ handled: true }),
    handleTurn: async () => ({ handled: true }),
    end: async () => {
      endCalled = true;
    },
  };

  const result = await resolveActiveSkill(db, "child-1", {
    nowMs,
    registry: [freshSkill],
  });

  assert.equal(result.skill?.id, "NONSENSE_QUIZ");
  assert.equal(result.sessionId, "nonsense-session-1");
  assert.equal(endCalled, false, "정상 1개 활성 세션은 end()가 호출되지 않아야 함");
  assert.deepEqual(result.cleaned, []);
});

test("Coordinator Case 4: Active 0개 → null", async () => {
  const db = createMockDb();

  const emptySkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 놀이",
    proposal: { label: "초성", shortDescription: "초성" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => null,
    start: async () => ({ handled: true }),
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const result = await resolveActiveSkill(db, "child-none", {
    registry: [emptySkill],
  });

  assert.equal(result.skill, null);
  assert.equal(result.sessionId, null);
  assert.deepEqual(result.cleaned, []);
});

test("Coordinator Case 5: updated_at·started_at 둘 다 없음 → stale 아님 (끊지 않음)", async () => {
  const db = createMockDb();
  const nowMs = 1700000000000;

  let endCalled = false;

  const noTimestampSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 놀이",
    proposal: { label: "초성", shortDescription: "초성" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => ({
      id: "legacy-session-no-ts",
      // updatedAt, startedAt undefined
    }),
    start: async () => ({ handled: true }),
    handleTurn: async () => ({ handled: true }),
    end: async () => {
      endCalled = true;
    },
  };

  const result = await resolveActiveSkill(db, "child-no-ts", {
    nowMs,
    registry: [noTimestampSkill],
  });

  assert.equal(result.skill?.id, "CHOSUNG", "시간 정보가 없어도 임의로 끊지 않고 활성 유지");
  assert.equal(result.sessionId, "legacy-session-no-ts");
  assert.equal(endCalled, false, "end()가 호출되지 않아야 함");
  assert.deepEqual(result.cleaned, []);
});
