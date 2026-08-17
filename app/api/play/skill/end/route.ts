import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { executeSkillEnd } from "@/lib/k-conversation/play/playEnd";

export const runtime = "nodejs";

// POST /api/play/skill/end
// UI 모달 또는 클라이언트에서 활성 놀이 Skill을 명시적으로 종료하는 API (§3-9, §3-12)
export async function POST(req: NextRequest) {
  // 1. 인증 확인
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { chatSessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // client에서 skillId, childId를 받지 않고 chatSessionId만 입력받음 (§3-9)
  const { chatSessionId } = body;
  if (!chatSessionId || typeof chatSessionId !== "string") {
    return NextResponse.json(
      { error: "chatSessionId required" },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // 2. chat_sessions 소유권 확인 (app/api/play/skill/select 관례 준수)
  const { data: session, error: sessionError } = await service
    .from("chat_sessions")
    .select("id, session_type, child_id")
    .eq("id", chatSessionId)
    .maybeSingle();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 3. child_id 서버 derive
  const { data: child, error: childErr } = await service
    .from("child_profiles")
    .select("id, member_id")
    .eq("id", session.child_id)
    .maybeSingle();

  if (childErr || !child?.member_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: member, error: memErr } = await service
    .from("family_members")
    .select("user_id")
    .eq("id", child.member_id)
    .maybeSingle();

  if (memErr || !member?.user_id || member.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 4~8. 활성 스킬 조회, 종료 실행, 실제 종료 여부 검증 및 pending proposal 정리
  const endResult = await executeSkillEnd({
    db: service,
    childId: session.child_id,
    chatSessionId,
    reason: "USER_ENDED",
  });

  if (!endResult.ok) {
    return NextResponse.json(
      { ok: false, error: endResult.error ?? "Failed to end play skill" },
      { status: 500 }
    );
  }

  return NextResponse.json(endResult);
}
