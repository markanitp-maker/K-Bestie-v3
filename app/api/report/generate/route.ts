import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import type { Turn } from "@/hooks/useGeminiLive";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

interface RequestBody {
  sessionId: string;
  transcript: Turn[];
}

/**
 * requests/017-report-check.md — 세션 종료 즉시 daily_reports를 생성하던 경로를
 * 제거했다. 리포트 생성 책임은 이제 새벽 03:00 KST 배치(하루 단위, child_id+
 * business_date로 그날의 미션+자유대화를 전부 합쳐 1건 생성 - supabase/functions/
 * _shared/batch.ts의 generateDailyReports)로 통합됐다. 이 경로는 대화 종료 처리
 * (chat_sessions.ended_at/turn_count 기록)만 담당한다 - 대화 원문 저장(chat_messages)은
 * 이미 /api/chat/messages가 턴마다 실시간으로 처리해 왔으므로 여기서 추가로 할 일이 없다.
 */
export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, transcript } = body;
  if (!sessionId || !Array.isArray(transcript)) {
    return NextResponse.json({ error: "sessionId and transcript required" }, { status: 400 });
  }

  const { data: session, error: sessionError } = await authClient
    .from("chat_sessions")
    .select("id, child_id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(authClient, user.id, session.child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const consentBlocked = await checkConsentForChild(session.child_id);
  if (consentBlocked) return consentBlocked;

  const approvalBlocked = await checkApprovalForChild(session.child_id);
  if (approvalBlocked) return approvalBlocked;

  const supabase = createServiceClient();

  const turnCount = transcript.filter((t) => t.role === "child").length;
  const { error: updateErr } = await supabase
    .from("chat_sessions")
    .update({ ended_at: new Date().toISOString(), turn_count: turnCount })
    .eq("id", sessionId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ reportId: null, deferredToDailyBatch: true });
}
