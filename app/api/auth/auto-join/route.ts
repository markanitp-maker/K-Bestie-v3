import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/auth/auto-join
 *
 * 소셜 로그인(카카오/구글) 완료 직후 프론트에서 호출.
 * 로그인된 사용자의 이메일을 기준으로:
 *   - parent_invitations.invited_email 일치 → 해당 가족에 parent로 자동 합류
 *   - child_profiles.email 일치          → 해당 가족에 child로 자동 합류
 *
 * 카카오 이메일 누락 케이스:
 *   user.email이 null/empty이면 joined:false, reason:"no_email" 반환.
 *   프론트는 이 경우 안내 메시지 표시 후 이메일 제공 방법을 안내해야 함.
 *
 * Response:
 *   { joined: true,  role, family_id, child_profile_id? }  — 합류 성공
 *   { joined: true,  already_member: true, role, family_id } — 이미 소속
 *   { joined: false, reason: "no_email"  }  — 카카오 이메일 없음
 *   { joined: false, reason: "no_match"  }  — 예약된 가족 없음
 *   { joined: false, reason: "limit"     }  — 부모 2인 초과
 */
export async function POST(_req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── 카카오 이메일 누락 처리 ──────────────────────────────────────
  const email = user.email?.trim().toLowerCase() ?? "";
  if (!email) {
    return NextResponse.json({
      joined: false,
      reason: "no_email",
      message:
        "카카오 계정에 이메일 정보가 없어 가족 자동 연결이 불가합니다. " +
        "카카오 앱 › 설정 › 개인정보 관리에서 이메일을 확인하거나, " +
        "구글 로그인을 이용해 주세요.",
    });
  }

  const svc = createServiceClient();

  // ── 이미 가족 구성원인지 확인 ─────────────────────────────────────
  // REQUEST-AUTH-SIGNUP-AUTOLOGIN 정적 리뷰(2026-08-05)에서 발견: deleted_at 필터가
  // 없어서, 단독 오너 보호자가 탈퇴(request_account_withdrawal)해 해당 가족의
  // family_members 전 행(아이 포함)에 deleted_at이 찍힌 뒤에도, 세션이 남아있는 아이
  // 계정이 여전히 "이미 구성원"으로 인식되어 SUSPENDED/DELETED 판정(membership-status)을
  // 거치지 않고 곧장 /child/home으로 들어갈 수 있었다(§13.5 필수 시나리오). 다른 활성
  // 판정 쿼리(lib/auth/membershipState.ts)와 동일하게 deleted_at을 필터링한다.
  const { data: existingMember } = await svc
    .from("family_members")
    .select("id, family_id, role")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingMember) {
    return NextResponse.json({
      joined: true,
      already_member: true,
      family_id: existingMember.family_id,
      role: existingMember.role,
    });
  }

  // ── 1순위: 부모 초대 이메일 매칭 ────────────────────────────────
  const { data: parentInv } = await svc
    .from("parent_invitations")
    .select("id, family_id, role")
    .eq("invited_email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (parentInv) {
    // 2인 한도 재확인
    const { count: parentCount } = await svc
      .from("family_members")
      .select("*", { count: "exact", head: true })
      .eq("family_id", parentInv.family_id)
      .in("role", ["owner_parent", "parent"]);

    if ((parentCount ?? 0) >= 2) {
      return NextResponse.json({
        joined: false,
        reason: "limit",
        message: "이 가족에는 이미 보호자가 2명 등록되어 있습니다.",
      });
    }

    const { error: memErr } = await svc.from("family_members").insert({
      family_id: parentInv.family_id,
      user_id: user.id,
      role: parentInv.role,
    });
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

    await svc
      .from("parent_invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", parentInv.id);

    return NextResponse.json({
      joined: true,
      role: parentInv.role,
      family_id: parentInv.family_id,
    });
  }

  // ── 2순위: 아이 프로필 이메일 매칭 ──────────────────────────────
  const { data: childProfile } = await svc
    .from("child_profiles")
    .select("id, family_id, member_id")
    .eq("email", email)
    .is("member_id", null) // 아직 Auth 계정과 미연결
    .maybeSingle();

  if (childProfile) {
    const { data: newMember, error: memErr } = await svc
      .from("family_members")
      .insert({ family_id: childProfile.family_id, user_id: user.id, role: "child" })
      .select("id")
      .single();

    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

    await svc
      .from("child_profiles")
      .update({ member_id: newMember.id })
      .eq("id", childProfile.id);

    return NextResponse.json({
      joined: true,
      role: "child",
      family_id: childProfile.family_id,
      child_profile_id: childProfile.id,
    });
  }

  // ── 매칭 없음 ────────────────────────────────────────────────────
  return NextResponse.json({
    joined: false,
    reason: "no_match",
    message: "이 계정으로 초대된 가족이 없습니다. 부모님께 이메일 주소를 확인해 주세요.",
  });
}
