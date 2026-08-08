import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { fetchQuizLeaderboard } from "@/lib/events/quizLeaderboardClient";
import { createServiceClient } from "@/lib/supabase/server";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";

export const runtime = "nodejs";

// GET /api/admin/events/quiz-leaderboard?period=2026-08
// fetchQuizLeaderboard가 퀴즈마스터와 공유하는 DB를 직접 읽어 마감 전/후를 모두 판단한다
// (2026-08-04 결정 — lib/events/quizLeaderboardClient.ts 주석 참고).
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const period = req.nextUrl.searchParams.get("period");
  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
  if (!period) {
    return NextResponse.json({ error: "period required" }, { status: 400 });
  }

  const result = await fetchQuizLeaderboard(period);
  if (!result.ok) {
    return NextResponse.json({ period, status: "unavailable", error: result.error }, { status: 502 });
  }

  const realEntries = result.data.entries.filter((entry) => !entry.isSeedUser);
  const childIds = realEntries.map((entry) => entry.childId);
  const service = createServiceClient();
  const { data: children } = childIds.length
    ? await service.from("child_profiles").select("id, family_id, member_id, is_internal_test, is_test_account").in("id", childIds)
    : { data: [] };
  const testFamilyIds = await getTestFamilyIds(service);
  const testChildIds = new Set((children ?? []).filter((child) => child.is_internal_test || child.is_test_account || testFamilyIds.has(child.family_id)).map((child) => child.id));
  const memberIds = (children ?? []).map((child) => child.member_id).filter(Boolean) as string[];
  const familyIds = [...new Set((children ?? []).map((child) => child.family_id).filter(Boolean))] as string[];
  const [{ data: members }, { data: families }] = await Promise.all([
    memberIds.length ? service.from("family_members").select("id, user_id").in("id", memberIds) : Promise.resolve({ data: [] }),
    familyIds.length ? service.from("families").select("id, name").in("id", familyIds) : Promise.resolve({ data: [] }),
  ]);
  const accountIds = (members ?? []).map((member) => member.user_id).filter(Boolean) as string[];
  const { data: accounts } = accountIds.length ? await service.from("member_accounts").select("id, username").in("id", accountIds) : { data: [] };
  const childById = new Map((children ?? []).map((child) => [child.id, child]));
  const accountIdByMemberId = new Map((members ?? []).map((member) => [member.id, member.user_id]));
  const usernameByAccountId = new Map((accounts ?? []).map((account) => [account.id, account.username]));
  const familyNameById = new Map((families ?? []).map((family) => [family.id, family.name]));
  return NextResponse.json({
    ...result.data,
    entries: result.data.entries.filter((entry) => entry.isSeedUser || includeTestAccounts || !testChildIds.has(entry.childId)).map((entry) => {
      if (entry.isSeedUser) return { ...entry, loginId: null, familyName: null, isInternalTest: false };
      const child = childById.get(entry.childId);
      const accountId = child?.member_id ? accountIdByMemberId.get(child.member_id) : null;
      return {
        ...entry,
        loginId: accountId ? usernameByAccountId.get(accountId) ?? "미등록" : "미등록",
        familyName: child?.family_id ? familyNameById.get(child.family_id) ?? "이름 없는 가족" : "가족 미등록",
        isInternalTest: testChildIds.has(entry.childId),
      };
    }),
  });
}
