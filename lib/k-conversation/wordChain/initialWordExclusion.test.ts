// 요청서 010 §3-4 — 끝말잇기 첫 단어 고정 반복 방지의 "제외 목록을 어디서 읽는가" 이음새.
//
// initialWordVariety.test.ts 는 selectInitialKWord 에 제외 목록을 **인자로 넣어** 검증한다.
// 그래서 통과했는데도 실제로는 고정 반복이 남아 있었다 — 프로덕션 경로에서 그 목록이
// 항상 비어 있었기 때문이다.
//
// 2026-08-20 Dev QA 실측: 같은 대화에서 끝말잇기를 두 번 시작했더니 두 번 다 "거북이" 로
// 시작했다. 원인은 getRecentInitialKWords 가 word_chain_game_rounds 에서 "세션별 가장
// 이른 K 낱말" 을 첫 단어로 봤던 것이다. startWordChainSession 은 K 의 첫 단어를 라운드로
// 남기지 않고 세션 행에만 적으므로, 라운드에서 처음 보이는 K 낱말은 아이 낱말 다음에 온
// 두 번째 낱말이다(거북이 → 이름표 → 표범). 첫 단어는 제외 목록에 한 번도 들어가지 않았다.

import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getRecentInitialKWords } from "./sessionManager";

type SessionRow = {
  child_id: string;
  used_words: unknown;
  initiated_by: string;
  started_at: string;
};

/**
 * word_chain_game_sessions 만 응답하는 최소 페이크. 라운드 테이블을 읽으면 즉시
 * 실패하게 두어, 첫 단어의 출처가 세션 행이라는 것을 테스트가 강제한다.
 */
function createFakeDb(rows: SessionRow[], opts?: { error?: boolean }) {
  const filters: Array<[string, unknown]> = [];
  return {
    from(tableName: string) {
      if (tableName !== "word_chain_game_sessions") {
        throw new Error(
          `첫 단어는 세션 행에서 읽어야 한다. 읽으려 한 테이블: ${tableName}`
        );
      }
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        order: () => builder,
        limit: async () => {
          if (opts?.error) return { data: null, error: { message: "boom" } };
          let filtered = rows;
          for (const [col, val] of filters) {
            filtered = filtered.filter(
              (row) => (row as unknown as Record<string, unknown>)[col] === val
            );
          }
          return { data: filtered, error: null };
        },
      };
      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    },
  } as unknown as SupabaseClient;
}

test("010: 첫 단어는 used_words[0] 다 — 라운드에 보이는 두 번째 K 낱말이 아니다", async () => {
  // 2026-08-20 실측 데이터 그대로. 라운드 기준으로는 "표범" 이 잡혀서 "거북이" 가
  // 제외되지 않았다.
  const db = createFakeDb([
    {
      child_id: "child-1",
      used_words: ["거북이", "이름표", "표범", "범고래", "내과", "과제", "제빵사"],
      initiated_by: "K",
      started_at: "2026-08-19T17:30:38.000Z",
    },
  ]);

  const words = await getRecentInitialKWords(db, "child-1");

  assert.deepEqual(words, ["거북이"]);
  assert.ok(!words.includes("표범"), "두 번째 K 낱말을 첫 단어로 오인했다");
});

test("010: 같은 첫 단어로 여러 번 시작했어도 한 번만 담는다", async () => {
  const db = createFakeDb([
    { child_id: "child-1", used_words: ["거북이"], initiated_by: "K", started_at: "2026-08-19T17:31:38.000Z" },
    {
      child_id: "child-1",
      used_words: ["거북이", "이름표"],
      initiated_by: "K",
      started_at: "2026-08-19T17:30:38.000Z",
    },
    { child_id: "child-1", used_words: ["김치전"], initiated_by: "K", started_at: "2026-08-19T15:09:51.000Z" },
  ]);

  const words = await getRecentInitialKWords(db, "child-1");

  assert.deepEqual(words, ["거북이", "김치전"]);
});

test("010: 아이가 먼저 시작한 세션의 첫 낱말은 K 의 첫 단어가 아니므로 세지 않는다", async () => {
  const db = createFakeDb([
    { child_id: "child-1", used_words: ["사과"], initiated_by: "CHILD", started_at: "2026-08-19T17:40:00.000Z" },
    { child_id: "child-1", used_words: ["거북이"], initiated_by: "K", started_at: "2026-08-19T17:30:00.000Z" },
  ]);

  const words = await getRecentInitialKWords(db, "child-1");

  assert.deepEqual(words, ["거북이"], "아이가 낸 낱말이 제외 목록에 섞였다");
});

test("010: used_words 가 비었거나 배열이 아니어도 터지지 않는다", async () => {
  const db = createFakeDb([
    { child_id: "child-1", used_words: [], initiated_by: "K", started_at: "2026-08-19T17:40:00.000Z" },
    { child_id: "child-1", used_words: null, initiated_by: "K", started_at: "2026-08-19T17:35:00.000Z" },
    { child_id: "child-1", used_words: ["  "], initiated_by: "K", started_at: "2026-08-19T17:32:00.000Z" },
    { child_id: "child-1", used_words: ["거북이"], initiated_by: "K", started_at: "2026-08-19T17:30:00.000Z" },
  ]);

  const words = await getRecentInitialKWords(db, "child-1");

  assert.deepEqual(words, ["거북이"]);
});

test("010: 조회가 실패하면 빈 배열이다 — 제외를 못 해도 게임은 되어야 한다", async () => {
  const db = createFakeDb([], { error: true });

  const words = await getRecentInitialKWords(db, "child-1");

  assert.deepEqual(words, []);
});
