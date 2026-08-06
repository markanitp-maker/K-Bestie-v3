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

  // 멱등성: 이미 본인이 소유/소속된 활성 가족이 존재하면 새 가족을 중복 생성하지 않고 기존 family 반환
  const { data: existingMembers } = await svc
    .from("family_members")
    .select("family_id, families(id, name, created_at)")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("joined_at", { ascending: true })
    .limit(1);

  if (existingMembers && existingMembers.length > 0 && existingMembers[0].families) {
    const existingFamily = Array.isArray(existingMembers[0].families)
      ? existingMembers[0].families[0]
      : existingMembers[0].families;
    if (existingFamily && (existingFamily as any).id) {
      const family = {
        id: (existingFamily as any).id,
        name: (existingFamily as any).name || name.trim(),
        created_at: (existingFamily as any).created_at || new Date().toISOString(),
      };
      await svc
        .from("signup_consents")
        .update({ family_id: family.id })
        .eq("user_id", user.id)
        .is("family_id", null);
      return NextResponse.json({ family }, { status: 200 });
    }
  }

  const { data, error } = await svc.rpc("create_family_with_owner", { 
    p_user_id: user.id, 
    p_name: name.trim() 
  });

  if (error) {
    console.error("[api/families] create_family_with_owner RPC error:", error);
    return NextResponse.json({ error: "가족을 만들지 못했습니다. 다시 시도해 주세요." }, { status: 500 });
  }

  if (!data || !data[0]) {
    return NextResponse.json({ error: "가족을 만들지 못했습니다. 다시 시도해 주세요." }, { status: 500 });
  }

  const result = data[0];

  if (!result.family_id) {
    return NextResponse.json(
      { error: "가족을 만들지 못했습니다. 다시 시도해 주세요." },
      { status: 500 }
    );
  }

  const family = {
    id: result.family_id,
    name: result.family_name || name.trim(),
    created_at: result.created_at || new Date().toISOString()
  };

  // 1단계(동의) 시점에 가족이 없어서 signup_consents.family_id가 NULL로 남아있는 행들 백필
  await svc
    .from("signup_consents")
    .update({ family_id: family.id })
    .eq("user_id", user.id)
    .is("family_id", null);

  const status = result.error_code === "already_member" ? 200 : 201;
  return NextResponse.json({ family }, { status });
}
