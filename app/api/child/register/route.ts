import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/child/register
// 부모가 아이 프로필 등록 — 가족이 없으면 기본 가족 자동 생성
export async function POST(req: NextRequest) {
  let body: { name: string; grade: string; interests: string[]; familyId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, grade, interests, familyId } = body;
  if (!name?.trim() || !grade || !Array.isArray(interests) || interests.length === 0) {
    return NextResponse.json({ error: "name, grade, interests 필수" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const svc = createServiceClient();

  // 부모가 없으면 parents 행 보장
  if (user) {
    await svc
      .from("parents")
      .upsert({ id: user.id, email: user.email ?? "" }, { onConflict: "id", ignoreDuplicates: true });
  }

  // 사용할 family_id 결정
  let resolvedFamilyId = familyId ?? null;

  if (user && resolvedFamilyId) {
    // 사용자가 해당 가족의 구성원(보호자)인지 검증 (IDOR 방어)
    const { data: mem } = await svc
      .from("family_members")
      .select("id")
      .eq("family_id", resolvedFamilyId)
      .eq("user_id", user.id)
      .in("role", ["owner_parent", "parent"])
      .maybeSingle();

    if (!mem) {
      return NextResponse.json({ error: "가족에 대한 접근 권한이 없습니다" }, { status: 403 });
    }
  }

  if (user && !resolvedFamilyId) {
    // 기존 가족 조회
    const { data: mem } = await svc
      .from("family_members")
      .select("family_id")
      .eq("user_id", user.id)
      .in("role", ["owner_parent", "parent"])
      .order("created_at")
      .limit(1)
      .single();

    if (mem) {
      resolvedFamilyId = mem.family_id;
    } else {
      // 가족 없으면 기본 가족 자동 생성
      const { data: newFamily } = await svc
        .from("families")
        .insert({ name: "우리 가족", created_by: user.id })
        .select("id")
        .single();

      if (newFamily) {
        resolvedFamilyId = newFamily.id;
        await svc
          .from("family_members")
          .insert({ family_id: newFamily.id, user_id: user.id, role: "owner_parent" });
      }
    }
  }

  if (!resolvedFamilyId) {
    return NextResponse.json({ error: "가족 정보가 필요합니다" }, { status: 400 });
  }

  // codex 044 리뷰 지적: child_profiles.tier가 실제 기능 게이팅의 단일 기준인데
  // (20260712300000_child_profiles_tier.sql), 신규 자녀 생성 시 이를 지정하지 않아
  // 컬럼 기본값(1=Care Start)으로 고정돼 부모의 승인 플랜(parents.tier, 신규 승인자는
  // 044에서 기본값 Care Insight=2)이 자녀에게 전혀 반영되지 않는 문제가 있었다.
  // 자녀 생성 시점의 부모 tier를 그대로 상속시켜 단일 기준을 맞춘다.
  let inheritedTier = 1;
  if (user) {
    const { data: parentRow } = await svc
      .from("parents")
      .select("tier")
      .eq("id", user.id)
      .maybeSingle();
    inheritedTier = parentRow?.tier ?? 1;
  }

  const { data, error } = await svc
    .from("child_profiles")
    .insert({ family_id: resolvedFamilyId, name: name.trim(), grade, interests, tier: inheritedTier })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: "아이 저장 실패: " + error.message }, { status: 500 });
  }

  return NextResponse.json({ childId: data.id });
}
