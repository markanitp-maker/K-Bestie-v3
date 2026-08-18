import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractWordChainHintsForSyllables,
  extractWordChainHintsFromSyllable,
  getWordChainHintsForSession,
  resolveWordChainHints,
} from "./wordChainHints";
import type { WordChainSessionRow } from "@/lib/k-conversation/wordChain/sessionManager";

function createMockDb(config: {
  activeWordChain?: Partial<WordChainSessionRow> | null;
  activeChosung?: { current_word: string } | null;
  throwDbError?: boolean;
  delayMs?: number;
}): SupabaseClient {
  const {
    activeWordChain = null,
    activeChosung = null,
    throwDbError = false,
    delayMs = 0,
  } = config;

  return {
    from: (table: string) => {
      if (throwDbError) {
        throw new Error(`DB connection failure: ${table}`);
      }

      const chain: any = {
        select: () => chain,
        eq: (col: string, val: any) => {
          chain._col = col;
          chain._val = val;
          return chain;
        },
        is: () => chain,
        maybeSingle: async () => {
          if (delayMs > 0) {
            await new Promise((res) => setTimeout(res, delayMs));
          }
          if (throwDbError) {
            return { data: null, error: { message: "DB internal error" } };
          }
          if (table === "word_chain_game_sessions") {
            return { data: activeWordChain, error: null };
          }
          if (table === "chosung_game_sessions") {
            return { data: activeChosung, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

test("1. 활성 끝말잇기 + 시작 글자 '프' -> phrases에 '프'로 시작하는 낱말이 들어간다", async () => {
  // '샤프' -> 끝음절 '프'
  const mockSession: WordChainSessionRow = {
    id: "session-1",
    child_id: "child-1",
    chat_session_id: "chat-1",
    initiated_by: "K",
    state: "CHILD_TURN",
    current_word: "샤프",
    current_difficulty: 1,
    used_words: ["샤프"],
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ended_at: null,
  };

  const hints = getWordChainHintsForSession(mockSession);
  assert.ok(hints.length > 0, "힌트 목록이 비어있지 않아야 함");
  assert.ok(
    hints.every((word) => word.startsWith("프")),
    "모든 힌트 단어가 '프'로 시작해야 함"
  );
  assert.ok(
    hints.includes("프랑스") || hints.includes("프로그램") || hints.includes("프라이팬"),
    "사전에 등록된 '프' 단어(프랑스 등)가 포함되어야 함"
  );

  // DB resolver를 통한 조회 검증
  const mockDb = createMockDb({ activeWordChain: mockSession });
  const resolved = await resolveWordChainHints(mockDb, { childId: "child-1" });
  assert.deepStrictEqual(resolved, hints);
});

test("2. 후보가 300개를 넘으면 300개로 잘리고 로그가 남는다", () => {
  // 많은 음절들을 묶어 300개를 초과하는 상황 시뮬레이션
  const syllables = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하"];
  const res = extractWordChainHintsForSyllables(syllables, 300);

  if (res.total > 300) {
    assert.strictEqual(res.phrases.length, 300, "300개로 잘려야 함");
    assert.strictEqual(res.trimmed, true, "trimmed 플래그가 true여야 함");
  } else {
    // maxLimit을 낮춰서 트리밍 로직이 정상 작동하는지 명시적 확인
    const smallRes = extractWordChainHintsForSyllables(["가", "사"], 10);
    assert.ok(smallRes.total > 10, "전체 후보 수는 10개를 넘어야 함");
    assert.strictEqual(smallRes.phrases.length, 10, "10개로 잘려야 함");
    assert.strictEqual(smallRes.trimmed, true, "trimmed 플래그가 true여야 함");
  }
});

test("3. 초성게임 활성 -> 끝말잇기 힌트가 들어가지 않는다 (정답 유출 방어)", async () => {
  // 초성게임만 활성이고 끝말잇기는 활성 세션이 없음
  const mockDb = createMockDb({
    activeChosung: { current_word: "호랑이" },
    activeWordChain: null,
  });

  const hints = await resolveWordChainHints(mockDb, { childId: "child-1" });
  assert.deepStrictEqual(hints, [], "초성게임 활성 시 끝말잇기 힌트는 비어 있어야 함");
  assert.ok(!hints.includes("호랑이"), "초성게임 정답이 힌트에 유출되면 안 됨");
});

test("4. 세션 조회 실패 / 타임아웃 -> 기존 3개 힌트로 정상 응답 (throw 하지 않는다)", async () => {
  // 1) DB 예외 발생
  const errorDb = createMockDb({ throwDbError: true });
  const errorHints = await resolveWordChainHints(errorDb, { childId: "child-1" });
  assert.deepStrictEqual(errorHints, [], "DB 오류 시 throw 없이 빈 배열 반환");

  // 2) 타임아웃 발생 (조회 지연 100ms, 타임아웃 20ms)
  const timeoutDb = createMockDb({
    delayMs: 100,
    activeWordChain: {
      id: "session-timeout",
      child_id: "child-1",
      current_word: "사과",
      state: "CHILD_TURN",
      ended_at: null,
    } as any,
  });
  const timeoutHints = await resolveWordChainHints(timeoutDb, { childId: "child-1" }, 20);
  assert.deepStrictEqual(timeoutHints, [], "타임아웃 발생 시 throw 없이 빈 배열 반환");
});

test("5. 놀이 없음 -> 기존 동작 그대로 (빈 배열 반환)", async () => {
  const mockDb = createMockDb({
    activeWordChain: null,
    activeChosung: null,
  });

  const hints = await resolveWordChainHints(mockDb, { childId: "child-1" });
  assert.deepStrictEqual(hints, [], "활성 세션이 없을 때는 빈 배열 반환");
});

test("6. 두음법칙 적용: '오리' -> '리'로 끝나면 '리' 및 '이'로 시작하는 단어가 힌트에 포함된다", () => {
  const res = extractWordChainHintsFromSyllable("리");
  assert.ok(res.phrases.length > 0);
  
  // '리'로 시작하는 단어 및 '이'로 시작하는 단어 모두 포함되는지 확인
  const hasLi = res.phrases.some((w) => w.startsWith("리"));
  const hasLee = res.phrases.some((w) => w.startsWith("이"));
  assert.ok(hasLi, "'리'로 시작하는 단어(리본 등)가 포함되어야 함");
  assert.ok(hasLee, "'이'로 시작하는 단어(이발 등)가 두음법칙으로 포함되어야 함");
});
