import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { fetchInChunks, getOffsetDateStr } from "@/lib/analytics/kstDate";
import { toDisplayFields } from "@/lib/admin/retentionDisplay";
import { resolveRetentionPeriodRange } from "@/lib/admin/retentionPeriod";
import { computeChildActivityMetrics } from "@/lib/admin/retentionChildMetrics";
import { getAppEventEnvironment } from "@/lib/events/environment";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
  const periodParam = req.nextUrl.searchParams.get("period");
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");

  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  const todayStr = nowKST.toISOString().slice(0, 10);
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  const ms = (iso: string) => new Date(iso).getTime();

  // 화면 상단 기간 선택(7일/14일/30일/이번 달/전체)이 그대로 이 목록의 "활성 일수"/
  // "미션 수" 등에 반영된다 — 예전엔 이 라우트가 period 파라미터를 아예 받지 않아
  // 항상 전체 누적으로 계산됐고, 이게 화면에 보이는 선택된 기간과 어긋나는 근본
  // 원인 중 하나였다.
  const displayRange = resolveRetentionPeriodRange(periodParam, todayStr, fromParam, toParam);
  // D1/D3/D7/W2 유지율 커브는 기간 선택과 무관한 별개 개념(가입 후 경과일 기준)이라
  // 항상 전체 이력에서 계산해야 한다.
  const allTimeRange = { fromStr: null, toStr: todayStr };

  const service = createServiceClient();

  // 1. Fetch child_profiles
  const childProfiles: any[] = [];
  let cpOffset = 0;
  while (true) {
    const { data, error } = await service.from("child_profiles").select("id, family_id, is_internal_test, grade, name, member_id").order("id").range(cpOffset, cpOffset + 999);
    if (error) return NextResponse.json({ error: `child_profiles 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    childProfiles.push(...data);
    if (data.length < 1000) break;
    cpOffset += 1000;
  }

  const allTestFamilyIds = await import("@/lib/admin/retentionFilter").then(m => m.getTestFamilyIds(service));
  const testFamilyIds = !includeTestAccounts ? allTestFamilyIds : new Set<string>();

  const validChildren = [];
  for (const c of childProfiles) {
    if (includeTestAccounts) {
      validChildren.push(c);
    } else {
      if (!c.is_internal_test && (!c.family_id || !testFamilyIds.has(c.family_id))) {
        validChildren.push(c);
      }
    }
  }

  // 이름·로그인 아이디 조인(child_profiles.member_id → family_members.id → family_members.user_id
  // → member_accounts.id). child_profiles.member_id는 family_members 행의 PK를 가리키지
  // member_accounts.id(실제 auth uid)를 직접 가리키지 않는다 — 승인 시점 실제 insert 순서
  // (app/api/admin/child-approval-requests/[id]/approve/route.ts)를 보면
  // family_members.insert({user_id: authUserId}) → familyMember.id 로 member_accounts.insert({id: authUserId})
  // → child_profiles.insert({member_id: familyMember.id}) 순이라, member_id를 member_accounts.id로
  // 바로 조회하면 항상 매칭에 실패해 로그인 아이디가 비어 보이는 버그가 있었다. family_members를
  // 한 단계 거쳐 실제 auth uid를 구한 뒤 member_accounts를 조회한다.
  const memberRowIds = Array.from(new Set(validChildren.map(c => c.member_id).filter(Boolean)));
  const authUserIdByMemberRowId = new Map<string, string>();
  if (memberRowIds.length > 0) {
    const { data: fmRows } = await service.from("family_members").select("id, user_id").eq("role", "child").in("id", memberRowIds);
    for (const fm of fmRows || []) {
      if (fm.user_id) authUserIdByMemberRowId.set(fm.id, fm.user_id);
    }
  }
  const authUserIds = Array.from(new Set(Array.from(authUserIdByMemberRowId.values())));
  const usernameMap = new Map<string, string>();
  if (authUserIds.length > 0) {
    const { data: memberData } = await service.from("member_accounts").select("id, username").in("id", authUserIds);
    for (const m of memberData || []) usernameMap.set(m.id, m.username);
  }

  const childIds = validChildren.map(c => c.id);

  // 2. child_login 이벤트 — "마지막 방문(lastVisitAt)"에만 쓴다(활성 일수 계산에는 더 이상
  // 쓰지 않음 — 활성 일수는 미션·자유대화·놀이 등 실제 활동 발생일 기준으로 바뀌었다).
  const loginRows: { id: string; child_id: string; occurred_at: string }[] = [];
  {
    let eOffset = 0;
    while (true) {
      const { data, error } = await service.from("behavior_events")
        .select("id, child_id, occurred_at")
        .eq("actor_type", "child")
        .eq("event_name", "child_login")
        .order("occurred_at").order("id")
        .range(eOffset, eOffset + 999);
      if (error) return NextResponse.json({ error: `behavior_events(child_login) 조회 실패: ${error.message}` }, { status: 500 });
      if (!data || data.length === 0) break;
      loginRows.push(...data);
      if (data.length < 1000) break;
      eOffset += 1000;
    }
  }
  const lastVisitByChild = new Map<string, string>();
  for (const row of loginRows) {
    if (!row.child_id) continue;
    const prev = lastVisitByChild.get(row.child_id);
    if (!prev || ms(row.occurred_at) > ms(prev)) lastVisitByChild.set(row.child_id, row.occurred_at);
  }

  // 3. 공통 집계 함수 — 선택된 기간(카드/표에 표시)과 전체 기간(D1/D3/D7/W2 커브)을
  // 각각 한 번씩만 계산한다. 두 값 모두 동일한 mission_progress/behavior_events dedupe
  // 규칙을 쓰므로 activeDaysTotal·missionCount가 서로 다른 기준으로 벌어지지 않는다.
  const displayMetrics = await computeChildActivityMetrics(service, childIds, displayRange);
  const allTimeMetrics = await computeChildActivityMetrics(service, childIds, allTimeRange);
  // 30일 이벤트는 관리자 화면의 선택 기간과 무관한 이벤트 자체 cutoff/기간 원장값이다.
  const missionEventRows = await fetchInChunks<{ child_id: string; mission_completed_count: number }>(
    async (chunk, from, to) => await service
      .from("child_mission_onboarding_events")
      .select("child_id, mission_completed_count")
      .eq("environment", getAppEventEnvironment())
      .in("child_id", chunk)
      .order("child_id")
      .range(from, to),
    childIds
  );
  const missionEventCountByChild = new Map(
    missionEventRows.map((row) => [row.child_id, row.mission_completed_count])
  );

  const childrenResult = [];
  for (const c of validChildren) {
    const authUserId = c.member_id ? authUserIdByMemberRowId.get(c.member_id) : undefined;
    const username = authUserId ? usernameMap.get(authUserId) : undefined;
    const display = displayMetrics.get(c.id) || { activeDaysTotal: 0, missionCount: 0, completedMissionCount: 0, incompleteMissionCount: 0, freechatCount: 0, playCount: 0, lastActivityAt: null, activeDates: [], missionByDate: {} };
    const allTime = allTimeMetrics.get(c.id) || { activeDates: [] as string[] };

    const stats: any = {
      childId: c.id,
      familyId: c.family_id,
      grade: c.grade || "알 수 없음",
      ...toDisplayFields(c.id, c.name, username),
      isTestAccount: allTestFamilyIds.has(c.family_id) || !!c.is_internal_test,
      lastVisitAt: lastVisitByChild.get(c.id) || null,
      activeDaysTotal: display.activeDaysTotal,
      missionCount: display.missionCount,
      completedMissionCount: display.completedMissionCount,
      incompleteMissionCount: display.incompleteMissionCount,
      missionEventCompletedCount: missionEventCountByChild.get(c.id) ?? 0,
      freechatCount: display.freechatCount,
      playCount: display.playCount,
      d1Retained: null,
      d3Retained: null,
      d7Retained: null,
      w2Retained: null,
      firstActiveDate: null as string | null,
    };

    // D1/D3/D7/W2 — 전체 이력 기준 첫 유의미 활동일(firstActiveDate)로부터 계산.
    const allTimeDates = new Set(allTime.activeDates);
    const firstActiveDate = allTime.activeDates.length > 0 ? allTime.activeDates[0] : null;
    stats.firstActiveDate = firstActiveDate;

    if (firstActiveDate) {
      const d1Str = getOffsetDateStr(firstActiveDate, 1);
      const d3Str = getOffsetDateStr(firstActiveDate, 3);
      const d7Str = getOffsetDateStr(firstActiveDate, 7);

      if (ms(d1Str) <= todayMs) stats.d1Retained = allTimeDates.has(d1Str);
      if (ms(d3Str) <= todayMs) stats.d3Retained = allTimeDates.has(d3Str);
      if (ms(d7Str) <= todayMs) stats.d7Retained = allTimeDates.has(d7Str);

      const w2StartStr = getOffsetDateStr(firstActiveDate, 8);
      const w2EndStr = getOffsetDateStr(firstActiveDate, 14);
      if (ms(w2EndStr) <= todayMs) {
        let visited = false;
        for (const d of allTimeDates) {
          if (ms(d) >= ms(w2StartStr) && ms(d) <= ms(w2EndStr)) { visited = true; break; }
        }
        stats.w2Retained = visited;
      }
    }

    childrenResult.push(stats);
  }

  return NextResponse.json({
    children: childrenResult,
    meta: {
      testAccountsExcluded: !includeTestAccounts,
      timezone: "Asia/Seoul",
      generatedAt: new Date().toISOString(),
      period: { key: periodParam || "7d", from: displayRange.fromStr, to: displayRange.toStr },
    }
  });
}
