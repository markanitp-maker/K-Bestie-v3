import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { excludeCurrentTurnRows, fetchSameSessionTurns } from "./sameSession";

type Row = { role: string; content: string; created_at: string; turn_id: string | null };

/** chat_sessions 소유 검증 + chat_messages 조회만 흉내내는 최소 스텁.
 * limit(n)에 실제 n을 적용해 LIMIT 보존(005 §3-7)을 검증할 수 있게 한다. */
function stubDb(rows: Row[], captured: { limit?: number; columns?: string } = {}) {
  return {
    from(table: string) {
      if (table === "chat_sessions") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "s1" }, error: null }) }) }) }),
        };
      }
      const builder = {
        select(columns: string) {
          captured.columns = columns;
          return builder;
        },
        eq: () => builder,
        order: () => builder,
        async limit(n: number) {
          captured.limit = n;
          return { data: rows.slice(0, n), error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

// created_at 내림차순(최신 먼저) — 실제 쿼리 정렬과 동일하게 구성한다.
function descRows(entries: Array<[string, string, string | null]>): Row[] {
  return entries.map(([role, content, turnId], index) => ({
    role,
    content,
    created_at: `2026-08-16T10:${String(59 - index).padStart(2, "0")}:00Z`,
    turn_id: turnId,
  }));
}

test("currentTurnId가 없으면 아무 turn도 제외하지 않는다", () => {
  const rows = descRows([["child", "응", "B"], ["k", "그랬구나", "A:k"], ["child", "응", "A"]]);
  assert.equal(excludeCurrentTurnRows(rows, undefined).length, 3);
  assert.equal(excludeCurrentTurnRows(rows, null).length, 3);
  assert.equal(excludeCurrentTurnRows(rows, "").length, 3);
});

test("동일 문자열 과거 발화는 보존하고 currentTurnId turn만 제외한다", () => {
  const rows = descRows([["child", "응", "B"], ["k", "그랬구나", "A:k"], ["child", "응", "A"]]);
  const kept = excludeCurrentTurnRows(rows, "B");
  assert.deepEqual(kept.map((row) => row.turn_id), ["A:k", "A"]);
  assert.equal(kept.filter((row) => row.content === "응").length, 1);
});

test("turn_id가 없는 legacy row는 제외되지 않는다", () => {
  const rows = descRows([["child", "지금", null], ["child", "과거", "A"]]);
  assert.deepEqual(excludeCurrentTurnRows(rows, "B").map((row) => row.content), ["지금", "과거"]);
});

test("현재 turn이 DB에 선저장돼 있으면 Same-session에서 빠진다", async () => {
  const rows = descRows([["child", "오늘 급식 맛있었어", "CUR"], ["k", "오 뭐 나왔는데?", "P1:k"], ["child", "학교 갔다 왔어", "P1"]]);
  const turns = await fetchSameSessionTurns(stubDb(rows), "c1", "s1", "CUR");
  assert.deepEqual(turns, [
    { role: "child", content: "학교 갔다 왔어" },
    { role: "k", content: "오 뭐 나왔는데?" },
  ]);
});

test("current turn 제외 후에도 과거 finalized turn 6개가 유지된다", async () => {
  const rows = descRows([
    ["child", "지금 발화", "CUR"],
    ["k", "k6", "T6:k"],
    ["child", "c6", "T6"],
    ["k", "k5", "T5:k"],
    ["child", "c5", "T5"],
    ["k", "k4", "T4:k"],
    ["child", "c4", "T4"],
  ]);
  const captured: { limit?: number; columns?: string } = {};
  const turns = await fetchSameSessionTurns(stubDb(rows, captured), "c1", "s1", "CUR");
  assert.equal(captured.limit, 7, "currentTurnId가 있으면 N+1건을 조회해야 한다");
  assert.match(captured.columns ?? "", /turn_id/);
  assert.equal(turns.length, 6);
  assert.equal(turns.some((turn) => turn.content === "지금 발화"), false);
});

test("currentTurnId가 없으면 기존 LIMIT 6 동작을 그대로 유지한다", async () => {
  const rows = descRows([["child", "a", "T1"], ["k", "b", "T1:k"]]);
  const captured: { limit?: number; columns?: string } = {};
  await fetchSameSessionTurns(stubDb(rows, captured), "c1", "s1");
  assert.equal(captured.limit, 6);
});
