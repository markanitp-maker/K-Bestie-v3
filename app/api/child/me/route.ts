import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/child/me
// 로그인한 현재 사용자의 아이 프로필 조회
export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // 1. family_members에서 이 user가 child로 소속된 행 검색
  const { data: member, error: memErr } = await svc
    .from("family_members")
    .select("id, family_id")
    .eq("user_id", user.id)
    .eq("role", "child")
    .maybeSingle();

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  if (!member) {
    return NextResponse.json({ error: "가족에 등록되지 않은 아이 계정입니다." }, { status: 404 });
  }

  // 2. child_profiles에서 member_id가 일치하는 행 검색
  const { data: child, error: childErr } = await svc
    .from("child_profiles")
    .select("id, family_id, member_id, name, given_name, family_name, grade, interests, email, created_at, tier, live_voice_name")
    .eq("member_id", member.id)
    .maybeSingle();

  if (childErr) {
    return NextResponse.json({ error: childErr.message }, { status: 500 });
  }

  if (!child) {
    return NextResponse.json({ error: "아이 프로필을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json(child);
}
