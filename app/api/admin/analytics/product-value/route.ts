import { NextRequest, NextResponse } from "next/server";
import { calendarDayDiff, kstDateOfTimestamp, resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import {
  buildActivityRetention,
  cohortCountAsOf,
  fetchAllAnalyticsRows,
  isWithinIsoRange,
  loadAnalyticsIdentity,
  roundAverage,
  roundRate,
  settledValue,
  stableAnalyticsRef,
  type ActivityPoint,
} from "@/lib/admin/analyticsPhase2";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const PRODUCT_VALUE_HISTORY_ROW_CAP = 20000;

interface EventRow { event_name: string; actor_id: string | null; child_id: string | null; family_id: string | null; feature: string; play_type: string | null; duration_seconds: number | null; occurred_at: string }
interface SessionRow { child_id: string; session_type: string; started_at: string; ended_at: string | null }
interface QuizRow { child_id: string; status: string; started_at: string; accumulated_time_seconds: number | null }
interface ReportRow { id: string; child_id: string | null }
interface ViewRow { report_id: string; viewed_at: string }
interface QuestionRow { parent_id: string | null; child_id: string; created_at: string }

interface FeatureSource {
  key: string;
  label: string;
  unit: "child" | "parent" | "family";
  /** 전체 이력(가입일 고정 코호트 기준 리텐션 계산용) */
  points: ActivityPoint[];
  /** 조회 기간 내 활동만(이용률·평균 소요시간 계산용) */
  periodPoints: ActivityPoint[];
  cohortDates: ReadonlyMap<string, string>;
  denominator: number;
  durations: number[];
  status?: "ready" | "unavailable";
  reason?: string;
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
      fetchAllAnalyticsRows<EventRow>(() => service.from("behavior_events")
        .select("event_name,actor_id,child_id,family_id,feature,play_type,duration_seconds,occurred_at")
        .lt("occurred_at", filters.toExclusiveIso), { column: "occurred_at", uniqueColumn: "id" }, 1000, PRODUCT_VALUE_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<SessionRow>(() => service.from("chat_sessions")
        .select("child_id,session_type,started_at,ended_at")
        .lt("started_at", filters.toExclusiveIso).is("deleted_at", null), { column: "started_at", uniqueColumn: "id" }, 1000, PRODUCT_VALUE_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<QuizRow>(() => service.from("quiz_attempts")
        .select("child_id,status,started_at,accumulated_time_seconds")
        .lt("started_at", filters.toExclusiveIso), { column: "started_at", uniqueColumn: "id" }, 1000, PRODUCT_VALUE_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<ReportRow>(() => service.from("daily_reports")
        .select("id,child_id").is("deleted_at", null), { column: "id", uniqueColumn: "id" }, 1000, PRODUCT_VALUE_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<ViewRow>(() => service.from("report_views")
        .select("report_id,viewed_at").lt("viewed_at", filters.toExclusiveIso), { column: "viewed_at", uniqueColumn: "id" }, 1000, PRODUCT_VALUE_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<QuestionRow>(() => service.from("parent_questions")
        .select("parent_id,child_id,created_at").lt("created_at", filters.toExclusiveIso), { column: "created_at", uniqueColumn: "id" }, 1000, PRODUCT_VALUE_HISTORY_ROW_CAP),
      fetchAllAnalyticsRows<EventRow>(() => service.from("behavior_events")
        .select("event_name,actor_id,child_id,family_id,feature,play_type,duration_seconds,occurred_at")
        .eq("event_name", "app_session_start").eq("feature", "app_session"), { column: "occurred_at", uniqueColumn: "id" }, 1000, PRODUCT_VALUE_HISTORY_ROW_CAP),
    ]);
    const identity = settledValue(settled[0], "분석 대상");
    const events = settledValue(settled[1], "행동 이벤트").filter((row) =>
      (row.child_id && identity.childIds.has(row.child_id)) || (row.actor_id && identity.parentIds.has(row.actor_id)));
    const sessions = settledValue(settled[2], "대화 세션").filter((row) => identity.childIds.has(row.child_id));
    const quizzes = settledValue(settled[3], "퀴즈 시도").filter((row) => identity.childIds.has(row.child_id));
    const reports = new Map(settledValue(settled[4], "일일 리포트")
      .filter((row) => row.child_id && identity.childIds.has(row.child_id)).map((row) => [row.id, row.child_id as string]));
    const views = settledValue(settled[5], "일일 리포트 열람").filter((row) => reports.has(row.report_id));
    const questions = settledValue(settled[6], "부모 질문").filter((row) => row.parent_id && identity.parentIds.has(row.parent_id));
    const visitRows = settledValue(settled[7], "방문 이벤트").filter((row) =>
      (row.actor_id && identity.parentIds.has(row.actor_id)) || (row.child_id && identity.childIds.has(row.child_id)));
    const measuredFrom = visitRows.length > 0 ? visitRows.map((row) => kstDateOfTimestamp(row.occurred_at)).sort()[0] : null;
    const visitCoverageReady = measuredFrom !== null && measuredFrom <= filters.from && calendarDayDiff(filters.from, filters.to) >= 6;
    const isWithinPeriod = (iso: string) => isWithinIsoRange(iso, filters.fromIso, filters.toExclusiveIso);
    // weeklyAverageVisits는 조회 기간 내 방문일만 세야 한다 — visitDates(전체 이력)를
    // 그대로 쓰면 기간 밖 방문까지 분자에 섞여 기간 지표가 과대 계산된다.
    const periodVisitDates = new Map<string, Set<string>>();
    for (const row of visitRows) {
      if (!isWithinPeriod(row.occurred_at)) continue;
      const userUnit = row.child_id ? row.child_id : row.actor_id;
      if (userUnit) {
        const dates = periodVisitDates.get(userUnit) ?? new Set<string>();
        dates.add(kstDateOfTimestamp(row.occurred_at));
        periodVisitDates.set(userUnit, dates);
      }
      const familyId = row.family_id ?? (row.child_id ? identity.childFamily.get(row.child_id) : undefined) ?? (row.actor_id ? identity.parentFamily.get(row.actor_id) : undefined);
      if (familyId) {
        const familyUnit = stableAnalyticsRef(familyId);
        const dates = periodVisitDates.get(familyUnit) ?? new Set<string>();
        dates.add(kstDateOfTimestamp(row.occurred_at));
        periodVisitDates.set(familyUnit, dates);
      }
    }
    const missionEvents = events.filter((row) => ["mission_start", "mission_complete"].includes(row.event_name) && row.child_id);
    const missionEventsPeriod = missionEvents.filter((row) => isWithinPeriod(row.occurred_at));
    const playEvents = events.filter((row) => row.event_name === "play_start" && row.child_id && row.play_type !== "quiz");
    const playEventsPeriod = playEvents.filter((row) => isWithinPeriod(row.occurred_at));
    const weeklyEvents = events.filter((row) => row.event_name === "parent_report_view" && row.feature === "weekly_report" && row.actor_id);
    const weeklyEventsPeriod = weeklyEvents.filter((row) => isWithinPeriod(row.occurred_at));
    const dailyPoints = views.map((row) => {
      const childId = reports.get(row.report_id) as string;
      const familyId = identity.childFamily.get(childId) as string;
      return { unitId: stableAnalyticsRef(familyId), occurredAt: row.viewed_at };
    });
    const dailyPointsPeriod = dailyPoints.filter((point) => isWithinPeriod(point.occurredAt));
    const freechatSessions = sessions.filter((row) => row.session_type === "free" || row.session_type === "free_chat");
    const freechatSessionsPeriod = freechatSessions.filter((row) => isWithinPeriod(row.started_at));
    const quizzesPeriod = quizzes.filter((row) => isWithinPeriod(row.started_at));
    const questionsPeriod = questions.filter((row) => isWithinPeriod(row.created_at));
    const familyCohortDates = new Map([...identity.familyCohortDates]
      .filter(([familyId]) => identity.familyIds.has(familyId))
      .map(([familyId, date]) => [stableAnalyticsRef(familyId), date]));
    // usageRate 분모는 "지금 기준 전체 가입자 수"가 아니라 "조회 기간 종료 시점까지
    // 가입한 사람 수"여야 한다 — 현재 전체 수를 쓰면 과거 기간을 조회할 때 그 기간
    // 이후 가입한 사람까지 분모에 섞여 과거 이용률이 실제보다 낮게 나온다.
    const childDenominator = cohortCountAsOf(identity.childCohortDates, filters.to);
    const parentDenominator = cohortCountAsOf(identity.parentCohortDates, filters.to);
    const familyDenominator = cohortCountAsOf(familyCohortDates, filters.to);
    const sources: FeatureSource[] = [
      { key: "mission", label: "미션", unit: "child", denominator: childDenominator,
        points: missionEvents.map((row) => ({ unitId: row.child_id as string, occurredAt: row.occurred_at })),
        periodPoints: missionEventsPeriod.map((row) => ({ unitId: row.child_id as string, occurredAt: row.occurred_at })),
        cohortDates: identity.childCohortDates,
        durations: missionEventsPeriod.map((row) => row.duration_seconds).filter((value): value is number => typeof value === "number") },
      { key: "freechat", label: "자유대화", unit: "child", denominator: childDenominator,
        points: freechatSessions.map((row) => ({ unitId: row.child_id, occurredAt: row.started_at })),
        periodPoints: freechatSessionsPeriod.map((row) => ({ unitId: row.child_id, occurredAt: row.started_at })),
        cohortDates: identity.childCohortDates,
        durations: freechatSessionsPeriod.filter((row) => row.ended_at).map((row) => (Date.parse(row.ended_at as string) - Date.parse(row.started_at)) / 1000).filter((value) => value >= 0) },
      { key: "quiz", label: "퀴즈", unit: "child", denominator: childDenominator,
        points: quizzes.map((row) => ({ unitId: row.child_id, occurredAt: row.started_at })),
        periodPoints: quizzesPeriod.map((row) => ({ unitId: row.child_id, occurredAt: row.started_at })),
        cohortDates: identity.childCohortDates,
        durations: quizzesPeriod.map((row) => Number(row.accumulated_time_seconds)).filter((value) => Number.isFinite(value) && value >= 0) },
      { key: "play", label: "놀이", unit: "child", denominator: childDenominator,
        points: playEvents.map((row) => ({ unitId: row.child_id as string, occurredAt: row.occurred_at })),
        periodPoints: playEventsPeriod.map((row) => ({ unitId: row.child_id as string, occurredAt: row.occurred_at })),
        cohortDates: identity.childCohortDates,
        durations: playEventsPeriod.map((row) => row.duration_seconds).filter((value): value is number => typeof value === "number") },
      { key: "daily_report", label: "일일 리포트", unit: "family", denominator: familyDenominator,
        points: dailyPoints, periodPoints: dailyPointsPeriod, cohortDates: familyCohortDates, durations: [] },
      { key: "weekly_report", label: "주간 리포트", unit: "parent", denominator: parentDenominator,
        points: weeklyEvents.map((row) => ({ unitId: row.actor_id as string, occurredAt: row.occurred_at })),
        periodPoints: weeklyEventsPeriod.map((row) => ({ unitId: row.actor_id as string, occurredAt: row.occurred_at })),
        cohortDates: identity.parentCohortDates, durations: [] },
      { key: "parent_question", label: "아이에게 물어보기", unit: "parent", denominator: parentDenominator,
        points: questions.map((row) => ({ unitId: row.parent_id as string, occurredAt: row.created_at })),
        periodPoints: questionsPeriod.map((row) => ({ unitId: row.parent_id as string, occurredAt: row.created_at })),
        cohortDates: identity.parentCohortDates, durations: [] },
      { key: "parent_k", label: "부모-K 대화", unit: "parent", denominator: parentDenominator,
        points: [], periodPoints: [], cohortDates: identity.parentCohortDates, durations: [],
        status: "unavailable", reason: "부모-K 전용 행동 이벤트가 아직 없습니다." },
    ];
    const weeks = Math.max(1, (calendarDayDiff(filters.from, filters.to) + 1) / 7);
    const features = sources.map((source) => {
      const users = new Set(source.periodPoints.map((point) => point.unitId));
      const retention = buildActivityRetention(source.points, filters.to, source.cohortDates);
      const totalVisitDays = [...users].reduce((sum, unit) => sum + (periodVisitDates.get(unit)?.size ?? 0), 0);
      return {
        key: source.key,
        label: source.label,
        unit: source.unit,
        users: source.status === "unavailable" ? null : users.size,
        usageRate: source.status === "unavailable" ? null : roundRate(users.size, source.denominator),
        averageDurationSeconds: source.status === "unavailable" ? null : roundAverage(source.durations),
        weeklyAverageVisits: visitCoverageReady && users.size > 0 ? { value: Math.round((totalVisitDays / users.size / weeks) * 10) / 10, status: "ready" } : { value: null, status: "accumulating", measuredFrom },
        d7: source.status === "unavailable" ? null : retention.d7,
        d14: source.status === "unavailable" ? null : retention.d14,
        w2: source.status === "unavailable" ? null : retention.w2,
        status: source.status ?? "ready",
        ...(source.reason ? { reason: source.reason } : {}),
      };
    });
    const scopedFeatures = features.filter((feature) => filters.scope === "all" || filters.scope === "family"
      || (filters.scope === "child" && feature.unit === "child")
      || (filters.scope === "parent" && (feature.unit === "parent" || feature.unit === "family")));
    return NextResponse.json({ filters, features: scopedFeatures, meta: { comparisonOnly: true, causalClaim: false, cohortBasis: "가입·생성 기준일(조회 기간과 무관, 리텐션 계산은 전체 이력 기준)", usageScope: "users/usageRate/averageDurationSeconds는 조회 기간 내 활동만 집계", visitSource: "behavior_events.app_session_start", generatedAt: new Date().toISOString() } });
  } catch (error) {
    console.error("[admin/analytics/product-value] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "서비스 가치 집계에 실패했습니다." }, { status: 500 });
  }
}
