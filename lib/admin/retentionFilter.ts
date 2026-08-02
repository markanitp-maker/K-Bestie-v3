import { SupabaseClient } from "@supabase/supabase-js";

/**
 * 내부 테스트 계정(is_internal_test = true)인 부모 또는 아이가 속한 모든 가족의 ID 목록을 반환한다.
 * 리텐션 지표 집계 시, includeTestAccounts가 false일 때 이 함수를 호출하여 해당 가족과
 * 연관된 모든 활동 이벤트를 일관되게 제외한다.
 */
export async function getTestFamilyIds(service: SupabaseClient): Promise<Set<string>> {
  const testFamilyIds = new Set<string>();

  // 1. 내부 테스트로 지정된 아이의 가족
  const { data: childData, error: childErr } = await service
    .from("child_profiles")
    .select("family_id")
    .eq("is_internal_test", true)
    .limit(1000);

  if (childErr) {
    throw new Error(`getTestFamilyIds: child_profiles 조회 실패: ${childErr.message}`);
  }
  for (const c of childData ?? []) {
    if (c.family_id) {
      testFamilyIds.add(c.family_id);
    }
  }

  // 2. 내부 테스트로 지정된 부모의 가족
  const { data: parentData, error: parentErr } = await service
    .from("family_members")
    .select("family_id")
    .eq("is_internal_test", true)
    .limit(1000);

  if (parentErr) {
    throw new Error(`getTestFamilyIds: family_members 조회 실패: ${parentErr.message}`);
  }
  for (const p of parentData ?? []) {
    if (p.family_id) {
      testFamilyIds.add(p.family_id);
    }
  }

  return testFamilyIds;
}
