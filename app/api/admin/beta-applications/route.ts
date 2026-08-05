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
        id,
        answers,
        created_at,
        deleted_at
      )
    `)
    .eq("approval_status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[api/admin/beta-applications] error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // requests/066 소프트 삭제 — 관리자 목록에서는 deleted_at IS NULL인 신청서만 본다.
  // 중첩 select라 서버에서 걸지 못하므로 여기서 제외한다.
  // 주의: "신청서가 아예 없는 승인 대기 부모"는 원래대로 계속 노출한다(삭제된 게 아니라
  // 애초에 설문을 안 낸 상태이므로, 여기서 숨기면 승인 대기 건이 관리자 눈에서 사라진다).
  const formatted = data
    .map((p: any) => {
      const applications = (p.beta_applications ?? []) as any[];
      const beta = applications.find((a) => a.deleted_at == null) ?? null;
      const hasOnlyDeleted = !beta && applications.length > 0;
      return { parent: p, beta, hasOnlyDeleted };
    })
    .filter((row) => !row.hasOnlyDeleted)
    .map(({ parent: p, beta }) => {
      const answers = beta?.answers ?? {};
      return {
        // 소프트 삭제 대상 id(beta_applications.id). 신청서가 없으면 null이고,
        // 이 경우 관리자 UI에서 삭제 버튼을 노출하지 않는다.
        id: beta?.id ?? null,
        user_id: p.id,
        name: p.name,
        phone: answers.phone ?? null,
        age_group: answers.age_group ?? null,
        referral_source: answers.referral_source ?? null,
        motivation: answers.motivation ?? null,
        created_at: beta?.created_at ?? null,
      };
    });

  return NextResponse.json(formatted);
}
