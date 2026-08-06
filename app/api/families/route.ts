import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireActiveAccount, requireOnboardingOrActive } from "@/lib/auth/requireActiveAccount";

export const runtime = "nodejs";

// GET /api/families — 내 가족 목록 (구성원 포함)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activeCheck = await requireActiveAccount(user.id);
  if (activeCheck) return activeCheck;

  // joined_at 오름차순 — syncChildrenFromDB()가 families[0]을 "활성 가족"으로 선택하므로,
  // 온보딩 반복 버그 등으로 이후에 빈 중복 가족이 생겨도 항상 가장 먼저 가입한(진짜) 가족이
  // 선택되도록 순서를 고정한다.
  const { data, error } = await supabase
    .from("family_members")
    .select("family_id, role, joined_at, families(id, name, created_at)")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("joined_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ families: data ?? [] });
}

// POST /api/families — 가족 생성 + 오너로 등록
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activeCheck = await requireOnboardingOrActive(user.id);
  if (activeCheck) return activeCheck;

  let name: string;
  try {
    ({ name } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!name?.trim()) return NextResponse.json({ error: "name 필수" }, { status: 400 });

  const svc = createServiceClient();

  const { data, error } = await svc.rpc("create_family_with_owner", { 
    p_user_id: user.id, 
    p_name: name.trim() 
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || !data[0]) {
    return NextResponse.json({ error: "가족 생성 응답 오류" }, { status: 500 });
  }

  if (data[0].error_code || !data[0].family_id) {
    return NextResponse.json(
      { error: data[0].error_code === "already_member" ? "이미 가족에 소속되어 있습니다." : "가족 생성 실패" },
      { status: data[0].error_code === "already_member" ? 409 : 500 }
    );
  }

  const family = {
    id: data[0].family_id,
    name: data[0].family_name,
    created_at: data[0].created_at
  };

  // REQUEST-AUTH-SIGNUP-AUTOLOGIN §5.1: 동의 기록에 가족 ID를 남겨야 하는데, 1단계
  // (동의)는 가족이 생기기 전이라 signup_consents.family_id가 NULL로 저장된다 — 가족이
  // 실제로 만들어진 지금 이 시점에 백필한다(claude-review 정적 리뷰 지적사항).
  await svc
    .from("signup_consents")
    .update({ family_id: family.id })
    .eq("user_id", user.id)
    .is("family_id", null);

  return NextResponse.json({ family }, { status: 201 });
}
