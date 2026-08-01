import { createServiceClient } from "@/lib/supabase/server";

export interface CloseResult {
  closed: string[];   // 마감된 session_id 목록
  skipped: string[];  // 메시지 없어서 그대로 둔 session_id 목록 (optional: 시작시각으로 닫기)
  errors: { sessionId: string; error: string }[];
}

/**
 * Step 1: 자유 대화 세션 마감
 *
 * targetDate(KST) 이전 날짜로 ended_at 없이 열려 있는 free 세션을
 * 마지막 메시지 시각으로 ended_at을 찍어 닫는다.
 * 미션 세션은 건드리지 않는다.
 *
 * @param targetDate  "YYYY-MM-DD" (배치 실행 날짜, 보통 오늘)
 */
export async function closeFreeSessions(targetDate: string): Promise<CloseResult> {
  const db = createServiceClient();
  const result: CloseResult = { closed: [], skipped: [], errors: [] };

  // 오늘 이전(포함) 날짜에 시작된, 아직 열린 free 세션 목록
  const { data: sessions, error: fetchErr } = await db
    .from("chat_sessions")
    .select("id, started_at")
    .eq("session_type", "free_chat")
    .is("ended_at", null)
    .lte("started_at", `${targetDate}T23:59:59+09:00`);

  if (fetchErr) {
    throw new Error(`closeFreeSessions: 세션 조회 실패 — ${fetchErr.message}`);
  }
  if (!sessions?.length) return result;

  for (const session of sessions) {
    try {
      // 해당 세션의 마지막 메시지 시각
      const { data: lastMsg } = await db
        .from("chat_messages")
        .select("created_at")
        .eq("session_id", session.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const endedAt = lastMsg?.created_at ?? session.started_at;

      const { error: updateErr } = await db
        .from("chat_sessions")
        .update({ ended_at: endedAt })
        .eq("id", session.id);

      if (updateErr) throw new Error(updateErr.message);

      result.closed.push(session.id);
    } catch (e) {
      result.errors.push({ sessionId: session.id, error: String(e) });
    }
  }

  return result;
}
