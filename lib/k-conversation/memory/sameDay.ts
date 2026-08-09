// Same-day tier — 오늘 다른 세션(미션/자유대화)에서 이미 나눈 이야기 요약.
// Same-session과 달리 "지금 이 세션 이전에, 오늘 다른 세션에서 무슨 일이 있었나"를 다룬다.
// 신규 모듈(071 4-tier 요구사항) — 오늘 KST 날짜 범위의 다른 chat_sessions를 조회한다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripControlChars } from "./textSanitize";

export interface SameDayTurn {
  role: "child" | "k";
  content: string;
  sessionType: "mission" | "free_chat" | null;
}

const MAX_TEXT = 160;
const MAX_SAME_DAY_TURNS = 6;
const MAX_OTHER_SESSIONS = 3;

function cleanText(value: unknown, maxLength = MAX_TEXT): string {
  if (typeof value !== "string") return "";
  return stripControlChars(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function kstDayRange(now: Date): { startUtc: string; endUtc: string } {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  const startKst = Date.UTC(y, m, d, 0, 0, 0);
  const endKst = Date.UTC(y, m, d, 23, 59, 59, 999);
  return {
    startUtc: new Date(startKst - kstOffsetMs).toISOString(),
    endUtc: new Date(endKst - kstOffsetMs).toISOString(),
  };
}

/** 오늘(KST) 시작된, 현재 세션이 아닌 다른 세션들의 마지막 대화 몇 마디를 가져온다.
 * 실패해도 대화를 막지 않는다(fail-open, 빈 배열 반환). */
export async function fetchSameDayTurns(
  db: SupabaseClient,
  childId: string,
  excludeSessionId: string | null | undefined,
  now: Date = new Date(),
): Promise<SameDayTurn[]> {
  try {
    const { startUtc, endUtc } = kstDayRange(now);

    const sessionQuery = db
      .from("chat_sessions")
      .select("id, session_type, started_at")
      .eq("child_id", childId)
      .gte("started_at", startUtc)
      .lte("started_at", endUtc)
      .order("started_at", { ascending: false })
      .limit(MAX_OTHER_SESSIONS + 1);

    const { data: sessions, error: sessionsError } = await sessionQuery;
    if (sessionsError || !Array.isArray(sessions)) return [];

    const otherSessions = sessions
      .filter((s) => s.id !== excludeSessionId)
      .slice(0, MAX_OTHER_SESSIONS);
    if (otherSessions.length === 0) return [];

    const sessionIds = otherSessions.map((s) => s.id);
    const sessionTypeById = new Map<string, "mission" | "free_chat" | null>(
      otherSessions.map((s) => [s.id, (s.session_type as "mission" | "free_chat" | null) ?? null]),
    );

    const { data: messages, error: messagesError } = await db
      .from("chat_messages")
      .select("session_id, role, content, created_at, turn_status")
      .in("session_id", sessionIds)
      .eq("turn_status", "finalized")
      .order("created_at", { ascending: false })
      .limit(MAX_SAME_DAY_TURNS);
    if (messagesError || !Array.isArray(messages)) return [];

    return messages
      .filter((row) => (row?.role === "child" || row?.role === "k") && typeof row?.content === "string")
      .reverse()
      .map((row) => ({
        role: row.role as "child" | "k",
        content: cleanText(row.content),
        sessionType: sessionTypeById.get(row.session_id) ?? null,
      }))
      .filter((row) => Boolean(row.content));
  } catch (error) {
    console.error("[k-conversation/memory/sameDay] lookup failed", (error as Error).message);
    return [];
  }
}
