import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkConsentForChild } from "@/lib/plan/consentGuard";

export const runtime = "nodejs";

// GET /api/chat/messages?sessionId=xxx
// 스크롤백(과거 대화 다시 불러오기)용 — 반드시 그 세션의 아이 본인만 조회 가능.
// 프라이버시 원칙(부모 원문 열람 불가)을 RLS 우회 후에도 동일하게 지키기 위해
// family_members.user_id === 현재 로그인 사용자 로 직접 검증한다(부모 계정은 절대 통과 못 함).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: session } = await service
    .from("chat_sessions")
    .select("id, child_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: child } = await service
    .from("child_profiles")
    .select("member_id")
    .eq("id", session.child_id)
    .maybeSingle();
  if (!child?.member_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: member } = await service
    .from("family_members")
    .select("user_id")
    .eq("id", child.member_id)
    .maybeSingle();

  // 세션 소유 아이 본인만 통과 — 부모/다른 가족 구성원은 user_id가 달라 여기서 막힘
  if (!member?.user_id || member.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const consentBlocked = await checkConsentForChild(session.child_id);
  if (consentBlocked) return consentBlocked;

  const { data: messages, error } = await service
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: messages ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; role?: string; content?: string; voiceMode?: string; asrConfidence?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, role, content, voiceMode: bodyVoiceMode, asrConfidence } = body;
  if (!sessionId || !role || !content?.trim()) {
    return NextResponse.json({ error: "sessionId, role, content required" }, { status: 400 });
  }
  if (role !== "child" && role !== "k") {
    return NextResponse.json({ error: "role must be child or k" }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: session, error: sessionError } = await service
    .from("chat_sessions")
    .select("id, session_type, child_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: child } = await service
    .from("child_profiles")
    .select("member_id")
    .eq("id", session.child_id)
    .maybeSingle();
  if (!child?.member_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: member } = await service
    .from("family_members")
    .select("user_id")
    .eq("id", child.member_id)
    .maybeSingle();

  // 세션 소유 아이 본인만 통과 — 부모/다른 가족 구성원은 user_id가 달라 여기서 막힘
  if (!member?.user_id || member.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const consentBlocked = await checkConsentForChild(session.child_id);
  if (consentBlocked) return consentBlocked;

  // mode: 기존 session_type 재사용(추가 쿼리 없음). 자유대화는 라이브가 없으므로
  // voice_mode를 클라이언트 입력과 무관하게 항상 stt_tts로 서버가 클램프한다.
  const mode: "mission" | "free" = session.session_type === "mission" ? "mission" : "free";
  const voiceMode: "stt_tts" | "live" =
    mode === "free" ? "stt_tts" : bodyVoiceMode === "live" ? "live" : "stt_tts";

  const { error } = await service
    .from("chat_messages")
    .insert({ session_id: sessionId, role, content: content.trim(), mode, voice_mode: voiceMode });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

