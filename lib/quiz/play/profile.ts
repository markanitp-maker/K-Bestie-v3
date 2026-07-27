import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

/**
 * 리더보드 표시용 identity 조회.
 *
 * 이전 상태(버그): 퀴즈마스터 독립 앱 시절 K-Bestie의 사용자 테이블을 볼 수 없어
 * `return null` 플레이스홀더로 남아 있었다. K-Bestie 내부로 포팅된 뒤에도 그대로
 * 남아 있어서 quiz_submit_attempt의 `p_name is not null and p_login_id is not null`
 * 가드가 항상 거짓이 됐고, 그 결과 리더보드에는 시드(더미) 행만 남고 실사용자 행이
 * 단 한 번도 insert되지 않았다.
 *
 * 확정 스펙: 리더보드의 고유 단위는 보호자 로그인 계정(user_id)이 아니라 아이
 * (child_id)다. 보호자 한 명이 여러 자녀를 플레이시켜도 자녀별로 다른 행이 된다.
 * 따라서 identity도 child_id 기준으로 조회한다.
 *
 * - name     = child_profiles.name (아이 이름)
 * - login_id = 그 아이 본인 계정의 member_accounts.username
 *              (child_profiles.member_id → family_members.user_id → member_accounts.id)
 *              login_id는 화면에 그대로 노출되지 않고 maskUserId()로 마스킹된다.
 *              아이 본인 계정이 없는 가정(보호자 계정으로만 플레이)에서는 아이별로
 *              안정적이고 결정적인 대체 토큰을 쓴다 — quiz_leaderboard.login_id가
 *              NOT NULL이라 null을 넣을 수 없고, 여기서 null을 반환하면 그 아이는
 *              영영 리더보드에 오르지 못하기 때문이다(이번 버그의 재발 경로).
 */

export interface LeaderboardIdentity {
  name: string;
  login_id: string;
}

function fallbackLoginId(childId: string): string {
  return `k${childId.replace(/-/g, "").slice(0, 8)}`;
}

export async function getLeaderboardIdentity(
  childId: string | null | undefined
): Promise<LeaderboardIdentity | null> {
  if (!childId) return null;

  const supabase = createServiceClient();

  const { data: child, error: childError } = await supabase
    .from("child_profiles")
    .select("id, name, member_id")
    .eq("id", childId)
    .maybeSingle();

  if (childError) throw new Error(`getLeaderboardIdentity: ${childError.message}`);
  if (!child) return null;

  const name = (child.name ?? "").trim();
  if (!name) return null;

  let loginId: string | null = null;

  if (child.member_id) {
    const { data: member, error: memberError } = await supabase
      .from("family_members")
      .select("user_id")
      .eq("id", child.member_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (memberError) throw new Error(`getLeaderboardIdentity: ${memberError.message}`);

    if (member?.user_id) {
      const { data: account, error: accountError } = await supabase
        .from("member_accounts")
        .select("username")
        .eq("id", member.user_id)
        .maybeSingle();

      if (accountError) throw new Error(`getLeaderboardIdentity: ${accountError.message}`);

      const username = (account?.username ?? "").trim();
      if (username) loginId = username;
    }
  }

  return { name, login_id: loginId ?? fallbackLoginId(childId) };
}
