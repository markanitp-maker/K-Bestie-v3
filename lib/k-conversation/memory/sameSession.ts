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

/** sessionId가 실제로 이 childId 소유인지 먼저 검증한 뒤에만 조회한다(스푸핑 방지). */
export async function fetchSameSessionTurns(
  db: SupabaseClient,
  childId: string,
  sessionId: string | null | undefined,
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
      .select("role,content,created_at")
      .eq("session_id", sessionId)
      .eq("turn_status", "finalized")
      .order("created_at", { ascending: false })
      .limit(MAX_SESSION_TURNS);
    if (error || !Array.isArray(data)) return [];

    return data
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
