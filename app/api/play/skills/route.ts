import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { resolveActiveSkill } from "@/lib/k-conversation/play/activeSkillCoordinator";
import { buildPlaySkillsCatalogDto } from "@/lib/k-conversation/play/playSelection";
import { PLAY_SKILL_REGISTRY } from "@/lib/k-conversation/play/skillRegistry";

export const runtime = "nodejs";

// GET /api/play/skills
// K놀이 모달용 카탈로그 조회 API (§3-2, §3-17)
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();

  // 1. family_members에서 현재 사용자가 child로 등록된 레코드 조회
  const { data: member, error: memErr } = await service
    .from("family_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("role", "child")
    .maybeSingle();

  if (memErr) {
    console.error("[play/skills] family_members query error:", memErr);
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. child_profiles에서 member_id로 아이 프로필 조회
  const { data: child, error: childErr } = await service
    .from("child_profiles")
    .select("id")
    .eq("member_id", member.id)
    .maybeSingle();

  if (childErr) {
    console.error("[play/skills] child_profiles query error:", childErr);
    return NextResponse.json({ error: childErr.message }, { status: 500 });
  }

  if (!child) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const consentBlocked = await checkConsentForChild(child.id);
  if (consentBlocked) return consentBlocked;

  const approvalBlocked = await checkApprovalForChild(child.id);
  if (approvalBlocked) return approvalBlocked;

  const chatSessionId = req.nextUrl.searchParams.get("chatSessionId") ?? undefined;

  // 3. resolveActiveSkill로 현재 활성 스킬 ID 확인 (stale 정리 동반)
  const activeResolution = await resolveActiveSkill(service, child.id, {
    chatSessionId,
  });
  const activeSkillId = activeResolution.skill ? activeResolution.skill.id : null;

  // 4. 레지스트리 기반 DTO 반환 (거대한 if/else 없이 map)
  const catalog = buildPlaySkillsCatalogDto(PLAY_SKILL_REGISTRY, activeSkillId);

  return NextResponse.json(catalog);
}
