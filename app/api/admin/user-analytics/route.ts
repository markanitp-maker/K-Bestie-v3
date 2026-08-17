import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { computeUserAnalytics } from "@/lib/admin/userAnalytics";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchWithPagination<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return results;
}

function getSettledValue<T>(result: PromiseSettledResult<T>, description: string): T {
  if (result.status === "fulfilled") {
    return result.value;
  }
  throw new Error(`${description} 실패: ${result.reason?.message || result.reason}`);
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const now = new Date();
  const searchParams = request.nextUrl.searchParams;
  let filters;
  try {
    filters = resolveAnalyticsKstFilters(searchParams, now);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "필터 파싱 실패";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const includeTestAccounts = searchParams.get("includeTestAccounts") === "true";
  const rawScope = searchParams.get("scope");
  const scope: "all" | "family" | "parent" | "child" =
    rawScope === "family" || rawScope === "parent" || rawScope === "child" ? rawScope : "all";

  const service = createServiceClient();

  try {
    const [
      testFamilyIdsResult,
      familiesResult,
      familyMembersResult,
      parentsResult,
      childrenResult,
      dailyReportsResult,
      reportViewsResult,
      missionProgressResult,
      behaviorEventsResult,
    ] = await Promise.allSettled([
      includeTestAccounts ? Promise.resolve(new Set<string>()) : getTestFamilyIds(service),
      service.from("families").select("id, name, created_at").is("deleted_at", null),
      service
        .from("family_members")
        .select("id, family_id, user_id, role, is_internal_test, joined_at, created_at")
        .is("deleted_at", null),
      service.from("parents").select("id, name, email, created_at"),
      service
        .from("child_profiles")
        .select("id, family_id, member_id, name, given_name, family_name, is_internal_test, is_test_account, created_at"),
      fetchWithPagination(async (from, to) => {
        return service.from("daily_reports").select("id, family_id, child_id, created_at").range(from, to);
      }),
      fetchWithPagination(async (from, to) => {
        return service.from("report_views").select("id, report_id, viewer_id, viewed_at").range(from, to);
      }),
      fetchWithPagination(async (from, to) => {
        return service
          .from("mission_progress")
          .select("session_id, child_id, status, business_date, updated_at")
          .range(from, to);
      }),
      fetchWithPagination(async (from, to) => {
        return service
          .from("behavior_events")
          .select("id, event_name, actor_type, actor_id, family_id, child_id, occurred_at")
          .in("event_name", [
            "mission_start",
            "freechat_start",
            "play_start",
            "parent_report_view",
            "parent_conversation_topic_view",
          ])
          .order("occurred_at")
          .order("id")
          .range(from, to);
      }),
    ]);

    const testFamilyIds = getSettledValue(testFamilyIdsResult, "testFamilyIds");
    const familiesDb = getSettledValue(familiesResult, "families");
    if (familiesDb.error) throw new Error(`families 조회 실패: ${familiesDb.error.message}`);

    const familyMembersDb = getSettledValue(familyMembersResult, "familyMembers");
    if (familyMembersDb.error) throw new Error(`family_members 조회 실패: ${familyMembersDb.error.message}`);

    const parentsDb = getSettledValue(parentsResult, "parents");
    if (parentsDb.error) throw new Error(`parents 조회 실패: ${parentsDb.error.message}`);

    const childrenDb = getSettledValue(childrenResult, "children");
    if (childrenDb.error) throw new Error(`child_profiles 조회 실패: ${childrenDb.error.message}`);

    const dailyReports = getSettledValue(dailyReportsResult, "dailyReports");
    const reportViews = getSettledValue(reportViewsResult, "reportViews");
    const missionProgress = getSettledValue(missionProgressResult, "missionProgress");
    const behaviorEvents = getSettledValue(behaviorEventsResult, "behaviorEvents");

    const analytics = computeUserAnalytics({
      families: familiesDb.data ?? [],
      familyMembers: familyMembersDb.data ?? [],
      parents: parentsDb.data ?? [],
      children: childrenDb.data ?? [],
      dailyReports,
      reportViews,
      missionProgress,
      behaviorEvents,
      testFamilyIds,
      includeTestAccounts,
      selectedFromDateStr: filters.from,
      selectedToDateStr: filters.to,
      now,
      scope,
    });

    return NextResponse.json(analytics, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[app/api/admin/user-analytics]", error);
    const message = error instanceof Error ? error.message : "사용자 분석 데이터를 불러오지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
