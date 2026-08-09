import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireActiveAccount } from "@/lib/auth/requireActiveAccount";

export const runtime = "nodejs";

// GET /api/child/[id]/account
// 오너 부모가 자녀의 로그인 아이디(username)를 확인하는 API
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: childId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeCheck = await requireActiveAccount(user.id);
  if (activeCheck) return activeCheck;

  const svc = createServiceClient();

  // ── 3단계: child_profiles에서 id, family_id, member_id 조회 ─────────────────
  const { data: childProfile } = await svc
    .from("child_profiles")
    .select("id, family_id, member_id")
    .eq("id", childId)
    .maybeSingle();

  if (!childProfile) {
    return NextResponse.json({ error: "자녀 프로필을 찾을 수 없습니다" }, { status: 404 });
  }

  // ── 4단계: family_members에서 family_id + 현재 보호자 소속을 검증 ────────────────
  const { data: ownerMember } = await svc
    .from("family_members")
    .select("role")
    .eq("family_id", childProfile.family_id)
    .eq("user_id", user.id)
    .in("role", ["owner_parent", "parent"])
    .is("deleted_at", null)
    .maybeSingle();

  if (!ownerMember) {
    return NextResponse.json(
      { error: "활성 보호자만 자녀 계정을 조회할 수 있습니다" },
      { status: 403 }
    );
  }

  // ── 5단계: child_profiles.member_id로 family_members(자녀 구성원 행) 조회해 user_id 획득 및 username 조회 ──
  if (!childProfile.member_id) {
    return NextResponse.json({ error: "발급된 계정이 없습니다" }, { status: 404 });
  }

  const { data: familyMember } = await svc
    .from("family_members")
    .select("user_id")
    .eq("id", childProfile.member_id)
    .eq("family_id", childProfile.family_id)
    .eq("role", "child")
    .is("deleted_at", null)
    .maybeSingle();

  if (!familyMember || !familyMember.user_id) {
    return NextResponse.json({ error: "발급된 계정이 없습니다" }, { status: 404 });
  }

  const { data: memberAccount } = await svc
    .from("member_accounts")
    .select("username")
    .eq("id", familyMember.user_id)
    .maybeSingle();

  if (!memberAccount) {
    return NextResponse.json({ error: "발급된 계정이 없습니다" }, { status: 404 });
  }

  // ── 6단계: 감사로그(view_account) INSERT (실패 시 무시) ─────────────────────
  try {
    const { error: auditError } = await svc
      .from("account_management_audit_log")
      .insert({
        actor_user_id: user.id,
        actor_email: user.email || "",
        action: "view_account",
        child_id: childId,
        family_id: childProfile.family_id,
      });
    if (auditError) {
      console.error("Failed to insert audit log:", auditError);
    }
  } catch (e) {
    console.error("Audit log exception:", e);
  }

  // ── 7단계: username 응답 (비밀번호 필드 절대 포함 금지) ──────────────────
  return NextResponse.json({ username: memberAccount.username });
}
