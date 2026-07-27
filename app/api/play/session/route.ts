import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { ATTEMPT_MAX_AGE_MS } from "@/lib/quiz/attemptWindow";

export const runtime = "nodejs";

/**
 * quizmaster는 k_play_sessions를 쓰지 않는다(황금열쇠 소비가 이 인프라를 의도적으로
 * 우회함 - lib/quiz/handoffToken.ts 참고). 진행 상태의 진짜 출처는 quiz_attempts이므로
 * 이 놀이 타입만 별도로 조회한다. docs/quiz-inapp-integration.md §5 참고.
 */
async function checkQuizmasterResume(
  service: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<{ canResume: boolean; progressState: null; sessionId: string | null }> {
  const cutoff = new Date(Date.now() - ATTEMPT_MAX_AGE_MS).toISOString();
  const { data, error } = await service
    .from("quiz_attempts")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["in_progress", "background"])
    .gt("started_at", cutoff)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[play/session] quizmaster attempt lookup failed:", error);
    return { canResume: false, progressState: null, sessionId: null };
  }

  const attemptId = (data as { id: string } | null)?.id ?? null;
  return { canResume: attemptId !== null, progressState: null, sessionId: attemptId };
}

export async function GET(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const child_id = url.searchParams.get("child_id");
  const play_type = url.searchParams.get("play_type");

  if (!child_id || !play_type) {
    return NextResponse.json({ error: "child_id and play_type required" }, { status: 400 });
  }

  const service = createServiceClient();
  const authCheck = await requireChildAccess(service, user.id, child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (play_type === "quizmaster") {
    return NextResponse.json(await checkQuizmasterResume(service, user.id));
  }

  const { data: sessionData, error: sessionErr } = await service
    .from("k_play_sessions")
    .select("id, status, progress_state, resume_expires_at")
    .eq("child_id", child_id)
    .eq("play_type", play_type)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionErr) {
    console.error("[play/session] Fetch error:", sessionErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!sessionData) {
    return NextResponse.json({ canResume: false, progressState: null, sessionId: null });
  }

  const { id, status, progress_state, resume_expires_at } = sessionData;

  const now = new Date();
  const expiresAt = resume_expires_at ? new Date(resume_expires_at) : null;
  const isExpired = expiresAt ? now > expiresAt : false;

  const canResume = status !== "completed" && !isExpired;

  return NextResponse.json({
    canResume,
    progressState: canResume ? progress_state : null,
    sessionId: canResume ? id : null,
  });
}
