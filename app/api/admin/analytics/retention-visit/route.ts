import { NextRequest, NextResponse } from "next/server";
import { kstDateOfTimestamp, resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import {
  buildActivityRetention,
  fetchAllAnalyticsRows,
  loadAnalyticsIdentity,
  settledValue,
} from "@/lib/admin/analyticsPhase2";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface VisitRow {
  actor_type: "parent" | "child";
  actor_id: string | null;
  child_id: string | null;
  occurred_at: string;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let filters;
  try {
    filters = resolveAnalyticsKstFilters(req.nextUrl.searchParams);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "잘못된 조회 기간입니다." }, { status: 400 });
  }
  const service = createServiceClient();
  try {
    const settled = await Promise.allSettled([
      loadAnalyticsIdentity(service, filters.internalTest, filters.channel),
      fetchAllAnalyticsRows<VisitRow>(() => service.from("behavior_events")
        .select("actor_type,actor_id,child_id,occurred_at")
        .eq("event_name", "app_session_start").eq("feature", "app_session")
        .lt("occurred_at", filters.toExclusiveIso), { column: "occurred_at", uniqueColumn: "id" }),
    ]);
    const identity = settledValue(settled[0], "분석 대상");
    const rows = settledValue(settled[1], "방문 이벤트");
    const parent = rows.filter((row) => row.actor_type === "parent" && row.actor_id && identity.parentIds.has(row.actor_id))
      .map((row) => ({ unitId: row.actor_id as string, occurredAt: row.occurred_at }));
    const child = rows.filter((row) => row.actor_type === "child" && row.child_id && identity.childIds.has(row.child_id))
      .map((row) => ({ unitId: row.child_id as string, occurredAt: row.occurred_at }));
    const measuredFrom = rows.length > 0
      ? rows.map((row) => kstDateOfTimestamp(row.occurred_at)).sort()[0]
      : null;
    // 계측(app_session_start) 시작 이전에 가입한 코호트는 해당 리텐션 윈도우 동안
    // 방문이 기록될 방법이 없었으므로 분모에서 제외한다 — 포함하면 "측정 불가"가
    // 구조적 0%로 잘못 보고된다(대표님 지정 #6: 0 강제 변환 금지).
    const eligibleParentCohorts = measuredFrom === null
      ? new Map<string, string>()
      : new Map([...identity.parentCohortDates].filter(([, date]) => date >= measuredFrom));
    const eligibleChildCohorts = measuredFrom === null
      ? new Map<string, string>()
      : new Map([...identity.childCohortDates].filter(([, date]) => date >= measuredFrom));
    const parentRetention = buildActivityRetention(parent, filters.to, eligibleParentCohorts);
    const childRetention = buildActivityRetention(child, filters.to, eligibleChildCohorts);
    const retentionValues = [...Object.values(parentRetention), ...Object.values(childRetention)];
    return NextResponse.json({
      filters,
      status: retentionValues.every((metric) => metric.status === "ready") ? "ready" : "accumulating",
      measuredFrom,
      parent: parentRetention,
      child: childRetention,
      meta: {
        source: "behavior_events.app_session_start",
        cohortBasis: "child_profiles/family_members.created_at (조회 기간과 무관한 가입·생성 기준일)",
        message: "각 윈도우에 도달한 코호트가 생기기 전까지 rate를 0으로 변환하지 않습니다. app_session_start 계측 시작(measuredFrom) 이전 가입 코호트는 분모에서 제외됩니다.",
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[admin/analytics/retention-visit] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "방문 리텐션 집계에 실패했습니다." }, { status: 500 });
  }
}
