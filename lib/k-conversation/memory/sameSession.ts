// Same-session tier — 이번 세션 안에서 오간 최근 턴.
// lib/relationship/relationshipContext.ts의 기존 조회 로직을 그대로 이관(로직 변경 없음).
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripControlChars } from "./textSanitize";

export interface SessionTurn {
  role: "child" | "k";
  content: string;
}

const MAX_SESSION_TURNS = 6;
const MAX_TEXT = 160;

export function normalizeSameSessionText(value: unknown, maxLength = MAX_TEXT): string {
  if (typeof value !== "string") return "";
  return stripControlChars(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** 현재 턴 row를 turn_id 기준으로 제외한다(문자열 비교 금지 — 아이가 실제로 같은 말을
 * 반복한 과거 발화는 보존되어야 한다). currentTurnId가 없으면 아무것도 제외하지 않는다. */
export function excludeCurrentTurnRows<T extends { turn_id?: unknown }>(
  rows: T[],
  currentTurnId: string | null | undefined,
): T[] {
  if (!currentTurnId) return rows;
  return rows.filter((row) => row?.turn_id !== currentTurnId);
}

/** sessionId가 실제로 이 childId 소유인지 먼저 검증한 뒤에만 조회한다(스푸핑 방지).
 * currentTurnId가 주어지면 그 turn만 Source에서 제외하되, 제외 때문에 과거 turn 개수가
 * MAX_SESSION_TURNS 미만으로 줄지 않도록 한 건 더 조회한다(005 §3-7). */
export async function fetchSameSessionTurns(
  db: SupabaseClient,
  childId: string,
  sessionId: string | null | undefined,
  currentTurnId?: string | null,
): Promise<SessionTurn[]> {
  if (!sessionId) return [];

  const { data: session, error: sessionError } = await db
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("child_id", childId)
    .maybeSingle();
  if (sessionError || !session) return [];

  try {
    const { data, error } = await db
      .from("chat_messages")
      .select("role,content,created_at,turn_id")
      .eq("session_id", sessionId)
      .eq("turn_status", "finalized")
      .order("created_at", { ascending: false })
      .limit(currentTurnId ? MAX_SESSION_TURNS + 1 : MAX_SESSION_TURNS);
    if (error || !Array.isArray(data)) return [];

    return excludeCurrentTurnRows(data, currentTurnId)
      .slice(0, MAX_SESSION_TURNS)
      .filter((row) => (row?.role === "child" || row?.role === "k") && typeof row?.content === "string")
      .reverse()
      .map((row) => ({
        role: row.role as "child" | "k",
        content: normalizeSameSessionText(row.content),
      }))
      .filter((row) => Boolean(row.content));
  } catch (error) {
    console.error("[k-conversation/memory/sameSession] lookup failed", (error as Error).message);
    return [];
  }
}
