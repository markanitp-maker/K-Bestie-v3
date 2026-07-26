import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient();

  // parents.id가 곧 auth.users.id(=user_id)다 - 별도 user_id 컬럼은 없다.
  // beta_applications는 phone/age_group 같은 개별 컬럼이 아니라 answers jsonb 하나로
  // 저장한다(설문 문항이 아직 확정되지 않아 유연한 구조로 설계됨) - answers 안의 키에서
  // 꺼낸다. 설문 문항이 바뀌어도 이 추출부만 고치면 되고 스키마 변경은 불필요하다.
  const { data, error } = await supabase
    .from("parents")
    .select(`
      id,
      name,
      approval_status,
      beta_applications (
        answers,
        created_at
      )
    `)
    .eq("approval_status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[api/admin/beta-applications] error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const formatted = data.map((p: any) => {
    const answers = p.beta_applications?.[0]?.answers ?? {};
    return {
      user_id: p.id,
      name: p.name,
      phone: answers.phone ?? null,
      age_group: answers.age_group ?? null,
      referral_source: answers.referral_source ?? null,
      motivation: answers.motivation ?? null,
      created_at: p.beta_applications?.[0]?.created_at ?? null,
    };
  });

  return NextResponse.json(formatted);
}
