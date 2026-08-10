import { NextRequest, NextResponse } from "next/server";
import { resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import {
  fetchAllAnalyticsRows,
  latestTimestamp,
  loadAnalyticsIdentity,
  settledValue,
  stableAnalyticsRef,
} from "@/lib/admin/analyticsPhase2";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface EventRow {
  event_name: string;
  actor_type: string;
  actor_id: string | null;
  child_id: string | null;
  family_id: string | null;
  feature: string;
  occurred_at: string;
}
interface SessionRow { child_id: string; session_type: string; started_at: string }
interface ReportRow { id: string; child_id: string | null }
interface ViewRow { report_id: string; viewed_at: string }
interface QuestionRow { child_id: string; parent_id: string | null; created_at: string }

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
      fetchAllAnalyticsRows<EventRow>((from, to) => service.from("behavior_events")
        .select("event_name,actor_type,actor_id,child_id,family_id,feature,occurred_at")
        .gte("occurred_at", filters.fromIso).lt("occurred_at", filters.toExclusiveIso)
        .order("occurred_at").range(from, to)),
      fetchAllAnalyticsRows<SessionRow>((from, to) => service.from("chat_sessions")
        .select("child_id,session_type,started_at").gte("started_at", filters.fromIso)
        .lt("started_at", filters.toExclusiveIso).is("deleted_at", null).order("started_at").range(from, to)),
      fetchAllAnalyticsRows<ReportRow>((from, to) => service.from("daily_reports")
        .select("id,child_id").is("deleted_at", null).order("id").range(from, to)),
      fetchAllAnalyticsRows<ViewRow>((from, to) => service.from("report_views")
        .select("report_id,viewed_at").gte("viewed_at", filters.fromIso)
        .lt("viewed_at", filters.toExclusiveIso).order("viewed_at").range(from, to)),
      fetchAllAnalyticsRows<QuestionRow>((from, to) => service.from("parent_questions")
        .select("child_id,parent_id,created_at").gte("created_at", filters.fromIso)
        .lt("created_at", filters.toExclusiveIso).order("created_at").range(from, to)),
    ]);
    const identity = settledValue(settled[0], "분석 대상");
    const events = settledValue(settled[1], "행동 이벤트").filter((row) => {
      const familyId = row.family_id
        ?? (row.child_id ? identity.childFamily.get(row.child_id) : undefined)
        ?? (row.actor_id ? identity.parentFamily.get(row.actor_id) : undefined);
      return Boolean(familyId && identity.familyIds.has(familyId));
    });
    const sessions = settledValue(settled[2], "대화 세션").filter((row) => identity.childIds.has(row.child_id));
    const reportChild = new Map(settledValue(settled[3], "일일 리포트")
      .filter((row) => row.child_id && identity.childIds.has(row.child_id))
      .map((row) => [row.id, row.child_id as string]));
    const views = settledValue(settled[4], "일일 리포트 열람").filter((row) => reportChild.has(row.report_id));
    const questions = settledValue(settled[5], "부모 질문").filter((row) => identity.childIds.has(row.child_id));
    const rows = [...identity.familyIds].map((familyId) => {
      const childIds = new Set([...identity.childFamily].filter(([, value]) => value === familyId).map(([id]) => id));
      const parentIds = new Set([...identity.parentFamily].filter(([, value]) => value === familyId).map(([id]) => id));
      const familyEvents = events.filter((row) => row.family_id === familyId
        || (row.child_id ? childIds.has(row.child_id) : false)
        || (row.actor_id ? parentIds.has(row.actor_id) : false));
      const familySessions = sessions.filter((row) => childIds.has(row.child_id));
      const familyQuestions = questions.filter((row) => childIds.has(row.child_id));
      const familyViews = views.filter((row) => childIds.has(reportChild.get(row.report_id) as string));
      const parentEvents = familyEvents.filter((row) => row.actor_type === "parent");
      const childEvents = familyEvents.filter((row) => row.actor_type === "child" || row.child_id);
      return {
        familyRef: stableAnalyticsRef(familyId),
        parentCount: parentIds.size,
        childCount: childIds.size,
        parentRecentActivityAt: latestTimestamp([...parentEvents.map((row) => row.occurred_at), ...familyQuestions.map((row) => row.created_at), ...familyViews.map((row) => row.viewed_at)]),
        childRecentActivityAt: latestTimestamp([...childEvents.map((row) => row.occurred_at), ...familySessions.map((row) => row.started_at)]),
        parentCoreActions: parentEvents.filter((row) => row.feature === "weekly_report" || row.feature === "conversation_topic").length + familyQuestions.length + familyViews.length,
        childCoreActions: childEvents.filter((row) => ["mission_start", "mission_complete", "play_start"].includes(row.event_name)).length + familySessions.length,
        missionCount: childEvents.filter((row) => row.event_name === "mission_start").length,
        freechatCount: familySessions.filter((row) => row.session_type === "free" || row.session_type === "free_chat").length,
        reportViews: { daily: familyViews.length, weekly: parentEvents.filter((row) => row.event_name === "parent_report_view" && row.feature === "weekly_report").length },
      };
    }).sort((left, right) => (right.parentRecentActivityAt ?? right.childRecentActivityAt ?? "").localeCompare(left.parentRecentActivityAt ?? left.childRecentActivityAt ?? ""));

    return NextResponse.json({ filters, families: rows, meta: { identifiers: "opaque_refs", generatedAt: new Date().toISOString() } });
  } catch (error) {
    console.error("[admin/analytics/families] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "가족 분석 집계에 실패했습니다." }, { status: 500 });
  }
}
