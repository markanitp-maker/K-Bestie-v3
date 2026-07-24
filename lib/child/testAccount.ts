import type { SupabaseClient } from "@supabase/supabase-js";

// 현재 로그인 사용자가 '테스트 계정 아이'인지 서버에서 재검증한다(Plan01 §3.4).
// 계정명이 아니라 child_profiles.is_test_account=true 로만 판정한다.
// 반환: 아이가 아니거나(부모/미소속) 테스트 계정이 아니면 null. 테스트 계정이면 { childId }.
export async function resolveTestChild(
  svc: SupabaseClient,
  userId: string
): Promise<{ childId: string } | null> {
  // 1. family_members에서 이 user가 child로 소속된 행
  const { data: member } = await svc
    .from("family_members")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "child")
    .maybeSingle();
  if (!member) return null;

  // 2. child_profiles.member_id 매칭 + is_test_account 확인
  const { data: child } = await svc
    .from("child_profiles")
    .select("id, is_test_account")
    .eq("member_id", member.id)
    .maybeSingle();
  if (!child || child.is_test_account !== true) return null;

  return { childId: child.id };
}

// 현재 로그인 사용자가 실제로 어떤 아이 계정에 속하는지 서버에서 확인한다(테스트/실계정
// 구분 없이 전부 허용 - 운영 MissionInner용). resolveTestChild와 조회 체인은 동일하되
// is_test_account 필터만 없다. 아이가 아니거나 미소속이면 null.
export async function resolveChildForUser(
  svc: SupabaseClient,
  userId: string
): Promise<{ childId: string } | null> {
  const { data: member } = await svc
    .from("family_members")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "child")
    .maybeSingle();
  if (!member) return null;

  const { data: child } = await svc
    .from("child_profiles")
    .select("id")
    .eq("member_id", member.id)
    .maybeSingle();
  if (!child) return null;

  return { childId: child.id };
}
