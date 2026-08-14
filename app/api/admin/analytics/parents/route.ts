import { NextRequest, NextResponse } from "next/server";
import { resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import {
  loadRetentionPeopleAnalytics,
  matchesSearch,
  paginate,
  sortParents,
  type ParentAnalyticsRow,
  type ParentUsageStatus,
} from "@/lib/admin/retentionPeopleAnalytics";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const PARENT_STATUSES = new Set<ParentUsageStatus>(["active", "low_engagement", "report_unread"]);

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
    const status = statusParam && PARENT_STATUSES.has(statusParam as ParentUsageStatus)
      ? statusParam as ParentUsageStatus
      : null;
    const familyId = params.get("familyId");
    const filtered = payload.parents.filter((row: ParentAnalyticsRow) => (
      matchesSearch([row.parentName, row.email, row.familyName, ...row.children.map((child) => child.childName)], search)
      && (!status || row.statuses.includes(status))
      && (!familyId || familyId === "all" || row.familyId === familyId)
    ));
    const sorted = sortParents(filtered, params.get("sort") ?? "report_rate_low");
    const page = paginate(sorted, Number(params.get("page") ?? 1), Number(params.get("pageSize") ?? 25));
    const statusSummary = payload.parents.reduce<Record<ParentUsageStatus, number>>((summary, row) => {
      for (const item of row.statuses) summary[item] += 1;
      return summary;
    }, { active: 0, low_engagement: 0, report_unread: 0 });

    return NextResponse.json({
      filters,
      ...page,
      statusSummary,
      options: {
        families: [...new Map(payload.parents.map((row) => [row.familyId, { id: row.familyId, name: row.familyName }])).values()]
          .sort((left, right) => left.name.localeCompare(right.name, "ko-KR")),
      },
      meta: {
        reportViewSource: "report_views",
        reportViewIdentity: payload.reportViewIdentity,
        reportViewIdentityReason: "report_views에 viewer_id가 없어 부모 열람은 가족 단위로 표시합니다.",
        generatedAt: new Date().toISOString(),
      },
    }, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    console.error("[admin/analytics/parents] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "부모별 분석을 불러오지 못했습니다." }, { status: 500 });
  }
}
