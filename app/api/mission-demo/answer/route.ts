import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; step?: number; answerText?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { sessionId, step, answerText } = body;
  if (!sessionId || !step || typeof answerText !== "string") {
    return NextResponse.json({ error: "sessionId, step, answerText required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: session } = await service.from("chat_sessions").select("id, child_id, demo_mode").eq("id", sessionId).single();
  if (!session || !session.demo_mode) return NextResponse.json({ error: "Invalid session" }, { status: 400 });

  const authCheck = await requireChildAccess(authClient, user.id, session.child_id);
  if (!authCheck.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: progress } = await service.from("mission_progress").select("valid_answer_count, question_states, status").eq("session_id", sessionId).single();
  if (!progress) return NextResponse.json({ error: "Progress not found" }, { status: 404 });

  if (progress.status === "COMPLETED") {
    return NextResponse.json({ validAnswerCount: progress.valid_answer_count, completed: true, nextStep: null, valid: true });
  }

  const states = progress.question_states || {};
  const stepKey = String(step);
  if (states[stepKey] === "answered") {
    return NextResponse.json({ validAnswerCount: progress.valid_answer_count, completed: false, nextStep: step + 1, valid: true });
  }

  if (answerText.trim() === "") {
    return NextResponse.json({ validAnswerCount: progress.valid_answer_count, completed: false, nextStep: step, valid: false });
  }

  const newValidCount = (progress.valid_answer_count ?? 0) + 1;
  const newStates = { ...states, [stepKey]: "answered" };
  const completed = newValidCount >= 10;

  const { error: updateErr } = await service.from("mission_progress").update({
    valid_answer_count: newValidCount,
    question_states: newStates,
    status: completed ? "COMPLETED" : "IN_PROGRESS"
  }).eq("session_id", sessionId);

  if (updateErr) {
    console.error("mission_progress update error:", updateErr);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  if (completed) {
    await service.from("chat_sessions").update({ ended_at: new Date().toISOString() }).eq("id", sessionId);
  }

  // 발화 기록
  const { error: msgErr } = await service.from("chat_messages").insert({
    session_id: sessionId,
    child_id: session.child_id,
    role: "child",
    content: answerText
  });
  if (msgErr) {
    console.error("chat_messages insert error:", msgErr);
  }

  return NextResponse.json({
    validAnswerCount: newValidCount,
    completed,
    nextStep: completed ? null : step + 1,
    valid: true
  });
}
