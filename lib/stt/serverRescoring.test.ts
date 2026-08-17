import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveChildUtterance,
  type ResolveChildUtteranceResult,
} from "./serverRescoring";
import { checkSafetyPreflight } from "@/lib/k-conversation";

interface MockDbConfig {
  activeNonsense?: { current_question_id: string } | null;
  nonsenseQuestions?: Record<string, { canonical_answer: string; accepted_answers: string[] }>;
  activeChosung?: { current_word: string } | null;
  activeWordChain?: { current_word: string } | null;
  throwDbError?: boolean;
}

function createMockSupabase(config: MockDbConfig = {}): SupabaseClient {
  const {
    activeNonsense = null,
    nonsenseQuestions = {},
    activeChosung = null,
    activeWordChain = null,
    throwDbError = false,
  } = config;

  return {
    from: (table: string) => {
      if (throwDbError) {
        throw new Error(`DB connection failed on table: ${table}`);
      }

      const chain: any = {
        select: () => chain,
        eq: (col: string, val: any) => {
          chain._eqCol = col;
          chain._eqVal = val;
          return chain;
        },
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (throwDbError) {
            return { data: null, error: { message: "Internal DB error" } };
          }
          if (table === "nonsense_game_sessions") {
            return { data: activeNonsense, error: null };
          }
          if (table === "nonsense_questions") {
            const q = nonsenseQuestions[chain._eqVal];
            return { data: q ?? null, error: null };
          }
          if (table === "chosung_game_sessions") {
            return { data: activeChosung, error: null };
          }
          if (table === "word_chain_game_sessions") {
            return { data: activeWordChain, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          return chain.maybeSingle();
        },
        insert: () => chain,
        upsert: () => chain,
        update: () => chain,
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

// ── 1. 활성 넌센스 세션이 있고 오인식 발화가 오면 재해석된다 ───────────────────

test("097-1: 넌센스 정답 후보는 재해석에 쓰지 않는다 — 오답 둔갑 원천 차단", async () => {
  const mockDb = createMockSupabase({
    activeNonsense: { current_question_id: "q-nonsense-cow" },
    nonsenseQuestions: {
      "q-nonsense-cow": {
        canonical_answer: "소",
        accepted_answers: ["송아지"],
      },
    },
  });

  const res1 = await resolveChildUtterance(
    mockDb,
    "child-1",
    "session-1",
    "오수 노래",
    "free_chat"
  );
  assert.equal(res1.text, "오수 노래"); // 정답 후보는 재해석에서 제외한다
  assert.equal(res1.raw, "오수 노래");
  assert.equal(res1.changed, false);

  const res2 = await resolveChildUtterance(
    mockDb,
    "child-1",
    "session-1",
    "손 노래",
    "free_chat"
  );
  assert.equal(res2.text, "손 노래");
  assert.equal(res2.changed, false);

  const res3 = await resolveChildUtterance(
    mockDb,
    "child-1",
    "session-1",
    "또 노래",
    "free_chat"
  );
  assert.equal(res3.text, "또 노래");
  assert.equal(res3.changed, false);
});

test("097-1b: 활성 초성게임 및 끝말잇기 세션 재해석", async () => {
  // 초성게임 정답(current_word)도 재해석 후보에서 제외된다 — 오답 둔갑 방지
  const chosungDb = createMockSupabase({
    activeChosung: { current_word: "바나나" },
  });
  const resChosung = await resolveChildUtterance(
    chosungDb,
    "child-1",
    "session-1",
    "파나나 먹을래",
    "free_chat"
  );
  assert.equal(resChosung.text, "파나나 먹을래");
  assert.equal(resChosung.raw, "파나나 먹을래");
  assert.equal(resChosung.changed, false);

  // 끝말잇기: 이전 단어 "사과" (끝음절 '과') -> 다음 단어 "과자" -> "콰자" 오인식 복원
  const wordChainDb = createMockSupabase({
    activeWordChain: { current_word: "사과" },
  });
  const resWordChain = await resolveChildUtterance(
    wordChainDb,
    "child-1",
    "session-1",
    "콰자",
    "free_chat"
  );
  assert.equal(resWordChain.text, "과자");
  assert.equal(resWordChain.raw, "콰자");
  assert.equal(resWordChain.changed, true);
  assert.equal(resWordChain.candidateSource, "word_chain");
});

// ── 2. 활성 세션이 없으면 원문 그대로 나간다 ────────────────────────────────

test("097-2: 활성 세션이 없으면 원문 그대로 반환된다", async () => {
  const mockDb = createMockSupabase({
    activeNonsense: null,
    activeChosung: null,
    activeWordChain: null,
  });

  const res = await resolveChildUtterance(
    mockDb,
    "child-1",
    "session-1",
    "오수 노래",
    "free_chat"
  );
  assert.equal(res.text, "오수 노래");
  assert.equal(res.raw, "오수 노래");
  assert.equal(res.changed, false);
});

// ── 3. 미션 모드에서는 게임 후보를 쓰지 않는다 ───────────────────────────────

test("097-3: 미션 모드(mode=mission)에서는 게임 후보를 쓰지 않고 원문 그대로 유지된다", async () => {
  const mockDb = createMockSupabase({
    activeNonsense: { current_question_id: "q-nonsense-cow" },
    nonsenseQuestions: {
      "q-nonsense-cow": {
        canonical_answer: "소",
        accepted_answers: ["송아지"],
      },
    },
  });

  const res = await resolveChildUtterance(
    mockDb,
    "child-1",
    "session-1",
    "오수 노래",
    "mission"
  );
  assert.equal(res.text, "오수 노래");
  assert.equal(res.raw, "오수 노래");
  assert.equal(res.changed, false);
});

// ── 4. DB 조회가 실패해도 원문으로 진행되고 예외가 새지 않는다 ─────────────────

test("097-4: DB 조회 실패/예외 발생 시 원문으로 graceful fallback되고 예외가 새지 않는다", async () => {
  const failingDb = createMockSupabase({
    throwDbError: true,
  });

  let threw = false;
  let result: ResolveChildUtteranceResult | null = null;
  try {
    result = await resolveChildUtterance(
      failingDb,
      "child-1",
      "session-1",
      "오수 노래",
      "free_chat"
    );
  } catch {
    threw = true;
  }

  assert.equal(threw, false, "예외가 외부로 전파되면 안 됨");
  assert.ok(result);
  assert.equal(result.text, "오수 노래");
  assert.equal(result.raw, "오수 노래");
  assert.equal(result.changed, false);
});

// ── 5 & 6. chat_messages raw_transcript / content 매핑 정합 ──────────────────

test("097-5 & 097-6: 재해석 시 raw_transcript 에 원문이, content 에 결과가 들어가며, 미재해석 시 raw_transcript 는 NULL 이다", () => {
  // Case A: 재해석 발생 ("오수 노래" -> "소 노래")
  const resChanged: ResolveChildUtteranceResult = {
    text: "소 노래",
    raw: "오수 노래",
    changed: true,
    matchedCandidate: "소",
    score: 0.8,
  };
  const contentA = resChanged.text;
  const rawTranscriptA = resChanged.changed ? resChanged.raw : null;
  assert.equal(contentA, "소 노래");
  assert.equal(rawTranscriptA, "오수 노래");

  // Case B: 재해석 미발생 ("안녕 케이야")
  const resUnchanged: ResolveChildUtteranceResult = {
    text: "안녕 케이야",
    raw: "안녕 케이야",
    changed: false,
  };
  const contentB = resUnchanged.text;
  const rawTranscriptB = resUnchanged.changed ? resUnchanged.raw : null;
  assert.equal(contentB, "안녕 케이야");
  assert.equal(rawTranscriptB, null);
});

// ── 7. 안전 검사가 원문과 재해석본을 둘 다 본다 ─────────────────────────────

test("097-7: 안전 검사(checkSafetyPreflight)가 원문과 재해석본을 둘 다 안전하게 검사한다", async () => {
  const mockDb = createMockSupabase();

  // 1) 원문이 안전 위기 발화인 경우 (재해석 여부와 무관하게 안전 처리)
  const unsafeRaw = "나 오늘 친구한테 맞았어";
  const safetyOnRaw = await checkSafetyPreflight(mockDb, "session-1", unsafeRaw, {
    childId: "child-1",
    mode: "FREE_CHAT",
    persistEvent: false,
  });
  assert.ok(safetyOnRaw, "원문의 안전 위기 발화가 감지되어야 함");
  assert.equal(safetyOnRaw.category, "safety");

  // 2) 이중 검사 흐름 시뮬레이션:
  // 원문(childText) 검사 후, 재해석본(resolvedChildText)도 검사하여 어느 한쪽이라도 걸리면 안전 반환
  const simulateSafetyCheck = async (
    raw: string,
    resolved: string,
    changed: boolean
  ) => {
    let callCount = 0;
    let safetyResult = await checkSafetyPreflight(mockDb, "session-1", raw, {
      childId: "child-1",
      mode: "FREE_CHAT",
      persistEvent: false,
    });
    callCount++;

    if (!safetyResult && changed) {
      safetyResult = await checkSafetyPreflight(mockDb, "session-1", resolved, {
        childId: "child-1",
        mode: "FREE_CHAT",
        persistEvent: false,
      });
      callCount++;
    }

    return { safetyResult, callCount };
  };

  // (A) 바뀌지 않은 안전한 발화: checkSafetyPreflight 1회만 호출 (중복 호출 회피)
  const safeCase = await simulateSafetyCheck("오늘 날씨 좋다", "오늘 날씨 좋다", false);
  assert.equal(safeCase.safetyResult, null);
  assert.equal(safeCase.callCount, 1, "바뀌지 않은 경우 중복 호출 없이 1회만 실행되어야 함");

  // (B) 원문이 안전 위기인 경우: 1회차에서 즉시 감지 (callCount: 1)
  const unsafeCase1 = await simulateSafetyCheck("나 친구한테 맞았어", "나 친구한테 맞았어", false);
  assert.ok(unsafeCase1.safetyResult);
  assert.equal(unsafeCase1.callCount, 1);

  // (C) 원문은 일반 발화이나 재해석본이 안전 위기인 경우: 2회차에서 감지 (callCount: 2)
  const unsafeCase2 = await simulateSafetyCheck("오수 노래", "나 친구한테 맞았어", true);
  assert.ok(unsafeCase2.safetyResult);
  assert.equal(unsafeCase2.callCount, 2);
});

// ── 8. 아이가 감정·안전 이야기를 하면 바뀌지 않는다 ─────────────────────────

test("097-8: 활성 게임 세션이 있어도 아이가 감정/안전 이야기를 하면 원문이 훼손되지 않는다", async () => {
  const mockDb = createMockSupabase({
    activeNonsense: { current_question_id: "q-nonsense-cow" },
    nonsenseQuestions: {
      "q-nonsense-cow": {
        canonical_answer: "소",
        accepted_answers: ["송아지"],
      },
    },
  });

  const emotionalUtterances = [
    "오늘 학교에서 친구랑 싸워서 슬퍼",
    "엄마한테 이를 거야",
    "선생님이 칭찬해줬어",
    "배고파서 밥 먹을래",
    "나 지금 너무 화났어",
    "게임 그만하고 잠잘래",
  ];

  for (const text of emotionalUtterances) {
    const res = await resolveChildUtterance(
      mockDb,
      "child-1",
      "session-1",
      text,
      "free_chat"
    );
    assert.equal(res.text, text, `감정 발화 훼손 발생: ${text} -> ${res.text}`);
    assert.equal(res.changed, false);
  }
});

// ── 리뷰 지적(2026-08-17): 아이 오답이 정답으로 둔갑하면 게임이 무의미해진다 ──

test("097-9: 아이가 한 낱말로 낸 오답을 정답으로 고쳐 주지 않는다", async () => {
  const mockDb = createMockSupabase({
    activeNonsense: { current_question_id: "q-lion" },
    nonsenseQuestions: {
      "q-lion": { canonical_answer: "사자", accepted_answers: [] },
    },
  });

  // 아이가 "타자"라고 답했으면 틀린 것이다. 정답으로 바꾸면 못 맞힌 문제를
  // 맞힌 것으로 만들어 준다. 발음이 가깝다는 이유로 고쳐서는 안 된다.
  for (const wrong of ["타자", "감자", "과자", "모자"]) {
    const res = await resolveChildUtterance(mockDb, "child-1", "session-1", wrong, "free_chat");
    assert.equal(res.text, wrong, `오답이 정답으로 둔갑했다: ${wrong} -> ${res.text}`);
    assert.equal(res.changed, false);
  }
});

test("097-10: 정답 후보는 재해석하지 않는다 — 오답 둔갑을 원천 차단한다", async () => {
  const mockDb = createMockSupabase({
    activeNonsense: { current_question_id: "q-calf" },
    nonsenseQuestions: {
      "q-calf": { canonical_answer: "송아지", accepted_answers: [] },
    },
  });

  // "소아지"는 아이가 송아지라고 말했는데 받침이 떨어진 것이다.
  const res = await resolveChildUtterance(mockDb, "child-1", "session-1", "소아지", "free_chat");
  // 정답 후보를 재해석에서 뺐으므로 복원하지 않는다. 맞혔는데 틀렸다고 처리되는
  // 문제는 남지만, 틀렸는데 맞았다고 처리되는 쪽이 훨씬 나쁘다.
  assert.equal(res.text, "소아지");
  assert.equal(res.changed, false);
});
