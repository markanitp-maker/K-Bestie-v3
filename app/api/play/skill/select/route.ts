import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { executeSkillSelection } from "@/lib/k-conversation/play/playSelection";

export const runtime = "nodejs";

// POST /api/play/skill/select
// UI 모달에서 특정 놀이 Skill을 명시적으로 선택하여 시작/재개하는 API (§3-3, §3-4)
export async function POST(req: NextRequest) {
  // 1. 인증 확인
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { chatSessionId?: string; skillId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // client에서 childId, gameSessionId를 받지 않고 chatSessionId, skillId 둘만 입력받음 (§3-4)
  const { chatSessionId, skillId } = body;
  if (
    !chatSessionId ||
    typeof chatSessionId !== "string" ||
    !skillId ||
    typeof skillId !== "string"
  ) {
    return NextResponse.json(
      { error: "chatSessionId and skillId required" },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // 2. chat_sessions 소유권 확인 (app/api/chat/messages 관례 준수)
  const { data: session, error: sessionError } = await service
    .from("chat_sessions")
    .select("id, session_type, child_id")
    .eq("id", chatSessionId)
    .maybeSingle();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 3. child_id 및 grade 서버 derive
  const { data: child, error: childErr } = await service
    .from("child_profiles")
    .select("id, member_id, grade")
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

  const consentBlocked = await checkConsentForChild(session.child_id);
  if (consentBlocked) return consentBlocked;

  const approvalBlocked = await checkApprovalForChild(session.child_id);
  if (approvalBlocked) return approvalBlocked;

  // 4~11. 스킬 선택 및 시작/재개 실행 (Hard Guard 및 단일 액티브 보장)
  const selectionResult = await executeSkillSelection({
    db: service,
    childId: session.child_id,
    chatSessionId,
    gradeRaw: child.grade,
    skillId,
  });

  if (!selectionResult.ok) {
    const status = selectionResult.error === "Invalid skillId" ? 400 : 500;
    return NextResponse.json(
      { ok: false, error: selectionResult.error ?? "Selection failed" },
      { status }
    );
  }

  return NextResponse.json(selectionResult);
}
