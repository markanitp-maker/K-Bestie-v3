import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

const DEMO_QUESTIONS = [
  { id: "greeting", question_text: "안녕, 나는 케이야. 넌 누구니?", audioUrl: "/demo-audio/01-greeting.wav" },
  { id: "school_life", question_text: "학교에서 오늘 무슨 일 있었어?", audioUrl: "/demo-audio/02-school_life.wav" },
  { id: "peer_relations", question_text: "오늘 친구랑 뭐 하고 놀았어?", audioUrl: "/demo-audio/03-peer_relations.wav" },
  { id: "emotion", question_text: "오늘 기분은 어때? 색깔로 말하면 무슨 색?", audioUrl: "/demo-audio/04-emotion.wav" },
  { id: "interests", question_text: "요즘 제일 좋아하는 게 뭐야?", audioUrl: "/demo-audio/05-interests.wav" },
  { id: "study_concerns", question_text: "요즘 학원이나 공부는 어때?", audioUrl: "/demo-audio/06-study_concerns.wav" },
  { id: "digital_interests", question_text: "요즘 유튜브나 게임 뭐 보고 있어?", audioUrl: "/demo-audio/07-digital_interests.wav" },
  { id: "future_dreams", question_text: "커서 뭐가 되고 싶어? 요즘 생각은 어때?", audioUrl: "/demo-audio/08-future_dreams.wav" },
  { id: "recurring_stories", question_text: "오늘 하루 중 가장 기억에 남는 순간은?", audioUrl: "/demo-audio/09-recurring_stories.wav" },
  { id: "daily_general", question_text: "지금 제일 하고 싶은 게 뭐야?", audioUrl: "/demo-audio/10-daily_general.wav" }
];

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { childId } = body;
  if (!childId) return NextResponse.json({ error: "childId required" }, { status: 400 });

  const authCheck = await requireChildAccess(authClient, user.id, childId);
  if (!authCheck.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const service = createServiceClient();
  
  const { data: existingSessionRow } = await service
    .from("chat_sessions")
    .select("id, demo_mode, mission_progress!inner(status, valid_answer_count, question_ids, question_states)")
    .eq("child_id", childId)
    .eq("session_type", "mission")
    .eq("demo_mode", true)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSessionRow) {
    const existingProgress = Array.isArray(existingSessionRow.mission_progress) ? existingSessionRow.mission_progress[0] : existingSessionRow.mission_progress;
    if (existingProgress?.status === "IN_PROGRESS") {
      const validCount = existingProgress.valid_answer_count ?? 0;
      return NextResponse.json({
        sessionId: existingSessionRow.id,
        questions: DEMO_QUESTIONS,
        closingAudioUrl: "/demo-audio/11-closing.wav",
        currentStep: validCount + 1,
        questionStates: existingProgress.question_states ?? {},
      });
    }
  }

  const { data: session, error: sessErr } = await service
    .from("chat_sessions")
    .insert({ child_id: childId, session_type: "mission", demo_mode: true })
    .select("id")
    .single();

  if (sessErr || !session) return NextResponse.json({ error: "Session insert failed" }, { status: 500 });

  const questionStates: Record<string, string> = {};
  DEMO_QUESTIONS.forEach((q, idx) => { questionStates[String(idx+1)] = "pending"; });

  const { error: mpErr } = await service.from("mission_progress").insert({
    session_id: session.id,
    child_id: childId,
    business_date: new Date().toISOString().split('T')[0],
    valid_answer_count: 0,
    question_ids: [],
    question_states: questionStates,
    round_type: "common",
    status: "IN_PROGRESS"
  });

  if (mpErr) {
    console.error("mission_progress insert error:", mpErr);
    return NextResponse.json({ error: "Mission progress insert failed" }, { status: 500 });
  }

  return NextResponse.json({
    sessionId: session.id,
    questions: DEMO_QUESTIONS,
    closingAudioUrl: "/demo-audio/11-closing.wav",
    currentStep: 1,
    questionStates
  });
}
