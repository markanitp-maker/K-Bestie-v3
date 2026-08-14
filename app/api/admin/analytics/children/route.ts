import { NextRequest, NextResponse } from "next/server";
import { resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import {
  loadRetentionPeopleAnalytics,
  matchesSearch,
  paginate,
  sortChildren,
  type ChildAnalyticsRow,
  type ChildUsageStatus,
  type RetentionResult,
} from "@/lib/admin/retentionPeopleAnalytics";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHILD_STATUSES = new Set<ChildUsageStatus>(["initial", "healthy", "low_usage", "churn_risk", "parent_unread"]);

function matchesRetention(value: RetentionResult, filter: string | null): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "success") return value === true;
  if (filter === "failure") return value === false;
  if (filter === "pending") return value === null;
  return true;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let filters;
  try {
    filters = resolveAnalyticsKstFilters(req.nextUrl.searchParams);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "조회 조건을 확인해 주세요." }, { status: 400 });
  }

  try {
    const payload = await loadRetentionPeopleAnalytics(createServiceClient(), filters);
    const params = req.nextUrl.searchParams;
    const search = params.get("search")?.slice(0, 100) ?? "";
    const statusParam = params.get("status");
    const status = statusParam && CHILD_STATUSES.has(statusParam as ChildUsageStatus)
      ? statusParam as ChildUsageStatus
      : null;
    const grade = params.get("grade");
    const familyId = params.get("familyId");
    const d1 = params.get("d1");
    const d7 = params.get("d7");

    const filtered = payload.children.filter((row: ChildAnalyticsRow) => (
      matchesSearch([row.childName, row.loginId, row.familyName, ...row.parentNames], search)
      && (!status || row.statuses.includes(status))
      && (!grade || grade === "all" || row.grade === grade)
      && (!familyId || familyId === "all" || row.familyId === familyId)
      && matchesRetention(row.d1, d1)
      && matchesRetention(row.d7, d7)
    ));
    const sorted = sortChildren(filtered, params.get("sort") ?? "last_oldest");
    const page = paginate(sorted, Number(params.get("page") ?? 1), Number(params.get("pageSize") ?? 25));
    const statusSummary = payload.children.reduce<Record<ChildUsageStatus, number>>((summary, row) => {
      for (const item of row.statuses) summary[item] += 1;
      return summary;
    }, { initial: 0, healthy: 0, low_usage: 0, churn_risk: 0, parent_unread: 0 });

    return NextResponse.json({
      filters,
      ...page,
      statusSummary,
      options: {
        grades: [...new Set(payload.children.map((row) => row.grade))].sort(),
        families: [...new Map(payload.children.map((row) => [row.familyId, { id: row.familyId, name: row.familyName }])).values()]
          .sort((left, right) => left.name.localeCompare(right.name, "ko-KR")),
      },
      meta: { reportViewSource: "report_views", generatedAt: new Date().toISOString() },
    }, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    console.error("[admin/analytics/children] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "아이별 분석을 불러오지 못했습니다." }, { status: 500 });
  }
}
