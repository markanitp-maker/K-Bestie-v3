import { createServiceClient } from "@/lib/supabase/server";

/** child_id가 기존 alpha_safety_text_allowlist에 등록돼 있으면 true(재사용 — 새 테이블 만들지 않음) */
export async function isChildAlphaAllowedForQuestions(childId: string): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("alpha_safety_text_allowlist")
    .select("child_id")
    .eq("child_id", childId)
    .limit(1);
  if (error) {
    console.error("[alphaAllowlist] query error:", error.message);
    return false; // fail-closed
  }
  return (data?.length ?? 0) > 0;
}
