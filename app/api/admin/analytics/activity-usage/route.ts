import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import {
  fetchAllAnalyticsRows,
  loadAnalyticsIdentity,
  roundAverage,
  roundRate,
  settledValue,
} from "@/lib/admin/analyticsPhase2";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface BehaviorRow {
  event_name: string;
  actor_id: string | null;
  child_id: string | null;
  family_id: string | null;
  feature: string;
  play_type: string | null;
  duration_seconds: number | null;
  occurred_at: string;
}

interface ChatSessionRow {
  id: string;
  child_id: string;
  session_type: string;
  started_at: string;
  ended_at: string | null;
}

interface QuizAttemptRow {
  id: string;
  child_id: string;
  status: string;
  started_at: string;
  accumulated_time_seconds: number | null;
}

interface DailyReportRow { id: string; child_id: string | null }
interface ReportViewRow { report_id: string; viewed_at: string }
interface ParentQuestionRow { id: string; child_id: string; parent_id: string | null; created_at: string }

function featureMetric(options: {
  key: string;
  label: string;
  unitIds: string[];
  usageCount: number;
  denominator: number;
  completedCount?: number | null;
  durations?: number[];
  status?: "ready" | "unavailable";
  reason?: string;
}) {
  return {
    key: options.key,
    label: options.label,
    uniqueUsers: options.status === "unavailable" ? null : new Set(options.unitIds).size,
    usageCount: options.status === "unavailable" ? null : options.usageCount,
    usageRate: options.status === "unavailable" ? null : roundRate(new Set(options.unitIds).size, options.denominator),
    completionRate: options.completedCount == null || options.usageCount === 0
      ? null
      : Math.min(roundRate(options.completedCount, options.usageCount) ?? 0, 100),
    averageDurationSeconds: roundAverage(options.durations ?? []),
    status: options.status ?? "ready",
    ...(options.reason ? { reason: options.reason } : {}),
  };
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
      fetchAllAnalyticsRows<BehaviorRow>(() => service.from("behavior_events")
        .select("event_name,actor_id,child_id,family_id,feature,play_type,duration_seconds,occurred_at")
        .gte("occurred_at", filters.fromIso).lt("occurred_at", filters.toExclusiveIso), { column: "occurred_at", uniqueColumn: "id" }),
      fetchAllAnalyticsRows<ChatSessionRow>(() => service.from("chat_sessions")
        .select("id,child_id,session_type,started_at,ended_at")
        .gte("started_at", filters.fromIso).lt("started_at", filters.toExclusiveIso)
        .is("deleted_at", null), { column: "started_at", uniqueColumn: "id" }),
      fetchAllAnalyticsRows<QuizAttemptRow>(() => service.from("quiz_attempts")
        .select("id,child_id,status,started_at,accumulated_time_seconds")
        .gte("started_at", filters.fromIso).lt("started_at", filters.toExclusiveIso), { column: "started_at", uniqueColumn: "id" }),
      fetchAllAnalyticsRows<DailyReportRow>(() => service.from("daily_reports")
        .select("id,child_id").is("deleted_at", null), { column: "id", uniqueColumn: "id" }),
      fetchAllAnalyticsRows<ReportViewRow>(() => service.from("report_views")
        .select("report_id,viewed_at").gte("viewed_at", filters.fromIso).lt("viewed_at", filters.toExclusiveIso), { column: "viewed_at", uniqueColumn: "id" }),
      fetchAllAnalyticsRows<ParentQuestionRow>(() => service.from("parent_questions")
        .select("id,child_id,parent_id,created_at")
        .gte("created_at", filters.fromIso).lt("created_at", filters.toExclusiveIso), { column: "created_at", uniqueColumn: "id" }),
    ]);
    const identity = settledValue(settled[0], "분석 대상");
    const events = settledValue(settled[1], "행동 이벤트").filter((row) => {
      if (row.child_id) return identity.childIds.has(row.child_id);
      if (row.actor_id) return identity.parentIds.has(row.actor_id);
      return row.family_id ? identity.familyIds.has(row.family_id) : false;
    });
    const sessions = settledValue(settled[2], "대화 세션").filter((row) => identity.childIds.has(row.child_id));
    const quizAttempts = settledValue(settled[3], "퀴즈 시도").filter((row) => identity.childIds.has(row.child_id));
    const reportChild = new Map(settledValue(settled[4], "일일 리포트")
      .filter((row) => row.child_id && identity.childIds.has(row.child_id))
      .map((row) => [row.id, row.child_id as string]));
    const dailyViews = settledValue(settled[5], "일일 리포트 열람")
      .filter((row) => reportChild.has(row.report_id));
    const parentQuestions = settledValue(settled[6], "부모 질문")
      .filter((row) => identity.childIds.has(row.child_id));

    const missionStarts = events.filter((row) => row.event_name === "mission_start" && row.child_id);
    const missionCompletes = events.filter((row) => row.event_name === "mission_complete" && row.child_id);
    const freechat = sessions.filter((row) => row.session_type === "free" || row.session_type === "free_chat");
    const playStarts = events.filter((row) => row.event_name === "play_start" && row.child_id && row.play_type !== "quiz");
    const playCompletes = events.filter((row) => row.event_name === "play_complete" && row.child_id && row.play_type !== "quiz");
    const weeklyViews = events.filter((row) => row.event_name === "parent_report_view" && row.feature === "weekly_report" && row.actor_id);
    const parentQuestionUsers = parentQuestions.map((row) => row.parent_id)
      .filter((id): id is string => typeof id === "string" && identity.parentIds.has(id));

    const child = [
      featureMetric({ key: "mission", label: "미션", unitIds: missionStarts.map((row) => row.child_id as string), usageCount: missionStarts.length, denominator: identity.childIds.size, completedCount: missionCompletes.length, durations: missionCompletes.map((row) => row.duration_seconds).filter((value): value is number => typeof value === "number") }),
      featureMetric({ key: "freechat", label: "자유대화", unitIds: freechat.map((row) => row.child_id), usageCount: freechat.length, denominator: identity.childIds.size, completedCount: freechat.filter((row) => row.ended_at).length, durations: freechat.filter((row) => row.ended_at).map((row) => (Date.parse(row.ended_at as string) - Date.parse(row.started_at)) / 1000).filter((value) => value >= 0 && value < 86_400) }),
      featureMetric({ key: "quiz", label: "퀴즈", unitIds: quizAttempts.map((row) => row.child_id), usageCount: quizAttempts.length, denominator: identity.childIds.size, completedCount: quizAttempts.filter((row) => row.status === "submitted").length, durations: quizAttempts.map((row) => Number(row.accumulated_time_seconds)).filter((value) => Number.isFinite(value) && value >= 0) }),
      featureMetric({ key: "play", label: "놀이", unitIds: playStarts.map((row) => row.child_id as string), usageCount: playStarts.length, denominator: identity.childIds.size, completedCount: playCompletes.length, durations: playCompletes.map((row) => row.duration_seconds).filter((value): value is number => typeof value === "number") }),
    ];
    const parent = [
      {
        key: "daily_report", label: "일일 리포트", uniqueUsers: null, usageCount: dailyViews.length,
        usageRate: null, completionRate: null, averageDurationSeconds: null, status: "ready",
        reason: "열람 Source of Truth인 report_views에 viewer_id가 없어 고유 부모 수와 이용률은 계산하지 않습니다.",
      },
      featureMetric({ key: "weekly_report", label: "주간 리포트", unitIds: weeklyViews.map((row) => row.actor_id as string), usageCount: weeklyViews.length, denominator: identity.parentIds.size }),
      featureMetric({ key: "parent_k", label: "부모-K 대화", unitIds: [], usageCount: 0, denominator: identity.parentIds.size, status: "unavailable", reason: "부모-K 대화의 전용 행동 이벤트가 아직 없어 값을 추정하지 않습니다." }),
      featureMetric({ key: "parent_question", label: "아이에게 물어보기", unitIds: parentQuestionUsers, usageCount: parentQuestions.length, denominator: identity.parentIds.size }),
    ];

    return NextResponse.json({
      filters,
      child: filters.scope === "parent" ? [] : child,
      parent: filters.scope === "child" ? [] : parent,
      meta: { internalTestExcluded: filters.internalTest === "exclude", generatedAt: new Date().toISOString() },
    });
  } catch (error) {
    console.error("[admin/analytics/activity-usage] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "서비스 이용 집계에 실패했습니다." }, { status: 500 });
  }
}
