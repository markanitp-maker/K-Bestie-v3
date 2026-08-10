import { NextRequest, NextResponse } from "next/server";
import { resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import {
  buildActivityRetention,
  fetchAllAnalyticsRows,
  loadAnalyticsIdentity,
  settledValue,
  stableAnalyticsRef,
  type ActivityPoint,
} from "@/lib/admin/analyticsPhase2";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RETENTION_HISTORY_ROW_CAP = 20000;

interface BehaviorRow {
  event_name: string;
  actor_id: string | null;
  child_id: string | null;
  family_id: string | null;
  feature: string;
  play_type: string | null;
  occurred_at: string;
}
interface SessionRow { child_id: string; session_type: string; started_at: string }
interface QuizRow { child_id: string; started_at: string }
interface ReportRow { id: string; child_id: string | null }
interface ViewRow { report_id: string; viewed_at: string }
interface QuestionRow { parent_id: string | null; child_id: string; created_at: string }

function retention(points: ActivityPoint[], asOfDate: string, cohortDateByUnit: ReadonlyMap<string, string>) {
  return buildActivityRetention(points, asOfDate, cohortDateByUnit);
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
        .select("event_name,actor_id,child_id,family_id,feature,play_type,occurred_at")
        .lt("occurred_at", filters.toExclusiveIso), { column: "occurred_at", uniqueColumn: "id" }, 1000, RETENTION_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<SessionRow>(() => service.from("chat_sessions")
        .select("child_id,session_type,started_at")
        .lt("started_at", filters.toExclusiveIso).is("deleted_at", null), { column: "started_at", uniqueColumn: "id" }, 1000, RETENTION_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<QuizRow>(() => service.from("quiz_attempts")
        .select("child_id,started_at").lt("started_at", filters.toExclusiveIso), { column: "started_at", uniqueColumn: "id" }, 1000, RETENTION_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<ReportRow>(() => service.from("daily_reports")
        .select("id,child_id").is("deleted_at", null), { column: "id", uniqueColumn: "id" }, 1000, RETENTION_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<ViewRow>(() => service.from("report_views")
        .select("report_id,viewed_at").lt("viewed_at", filters.toExclusiveIso), { column: "viewed_at", uniqueColumn: "id" }, 1000, RETENTION_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<QuestionRow>(() => service.from("parent_questions")
        .select("parent_id,child_id,created_at").lt("created_at", filters.toExclusiveIso), { column: "created_at", uniqueColumn: "id" }, 1000, RETENTION_HISTORY_ROW_CAP),
    ]);
    const identity = settledValue(settled[0], "분석 대상");
    const events = settledValue(settled[1], "행동 이벤트").filter((row) =>
      (row.child_id && identity.childIds.has(row.child_id))
      || (row.actor_id && identity.parentIds.has(row.actor_id))
      || (row.family_id && identity.familyIds.has(row.family_id)));
    const sessions = settledValue(settled[2], "대화 세션").filter((row) => identity.childIds.has(row.child_id));
    const quizzes = settledValue(settled[3], "퀴즈 시도").filter((row) => identity.childIds.has(row.child_id));
    const reports = new Map(settledValue(settled[4], "일일 리포트")
      .filter((row) => row.child_id && identity.childIds.has(row.child_id))
      .map((row) => [row.id, row.child_id as string]));
    const views = settledValue(settled[5], "일일 리포트 열람").filter((row) => reports.has(row.report_id));
    const questions = settledValue(settled[6], "부모 질문").filter((row) => identity.childIds.has(row.child_id));

    const mission = events.filter((row) => ["mission_start", "mission_complete"].includes(row.event_name) && row.child_id)
      .map((row) => ({ unitId: row.child_id as string, occurredAt: row.occurred_at }));
    const freechat = sessions.filter((row) => row.session_type === "free" || row.session_type === "free_chat")
      .map((row) => ({ unitId: row.child_id, occurredAt: row.started_at }));
    const quiz = quizzes.map((row) => ({ unitId: row.child_id, occurredAt: row.started_at }));
    const play = events.filter((row) => row.event_name === "play_start" && row.child_id && row.play_type !== "quiz")
      .map((row) => ({ unitId: row.child_id as string, occurredAt: row.occurred_at }));
    const dailyReport = views.map((row) => {
      const childId = reports.get(row.report_id) as string;
      const familyId = identity.childFamily.get(childId) as string;
      return { unitId: stableAnalyticsRef(familyId), occurredAt: row.viewed_at };
    });
    const weeklyReport = events.filter((row) => row.event_name === "parent_report_view" && row.feature === "weekly_report" && row.actor_id)
      .map((row) => ({ unitId: row.actor_id as string, occurredAt: row.occurred_at }));
    const parentQuestion = questions.filter((row) => row.parent_id && identity.parentIds.has(row.parent_id))
      .map((row) => ({ unitId: row.parent_id as string, occurredAt: row.created_at }));
    const familyCohortDates = new Map([...identity.familyCohortDates]
      .filter(([familyId]) => identity.familyIds.has(familyId))
      .map(([familyId, date]) => [stableAnalyticsRef(familyId), date]));

    return NextResponse.json({
      filters,
      child: filters.scope === "parent" ? null : {
        mission: retention(mission, filters.to, identity.childCohortDates),
        freechat: retention(freechat, filters.to, identity.childCohortDates),
        quiz: retention(quiz, filters.to, identity.childCohortDates),
        play: retention(play, filters.to, identity.childCohortDates),
      },
      parent: filters.scope === "child" ? null : {
        report_view: {
          unit: "family",
          reason: "report_views에 viewer_id가 없어 가족 단위로만 계산합니다.",
          daily: retention(dailyReport, filters.to, familyCohortDates),
          weekly: retention(weeklyReport, filters.to, identity.parentCohortDates),
        },
        parent_k: { status: "unavailable", reason: "부모-K 전용 행동 이벤트가 아직 없습니다.", metrics: null },
        parent_question: retention(parentQuestion, filters.to, identity.parentCohortDates),
      },
      meta: {
        cohortBasis: "child_profiles/family_members/families.created_at (조회 기간과 무관한 가입·생성 기준일)",
        activityRange: `최초 기록부터 ${filters.to}까지`,
        incompleteCohortsAreNull: true,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[admin/analytics/retention-activity] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "활동 리텐션 집계에 실패했습니다." }, { status: 500 });
  }
}
