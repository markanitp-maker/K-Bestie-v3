import { NextRequest, NextResponse } from "next/server";
import {
  calendarDayDiff,
  enumerateCalendarDates,
  kstDateOfTimestamp,
  offsetCalendarDate,
  resolveAnalyticsKstFilters,
} from "@/lib/admin/analyticsKst";
import {
  accumulatingMetric,
  fetchAllAnalyticsRows,
  loadAnalyticsIdentity,
  readyMetric,
  roundRate,
  settledValue,
} from "@/lib/admin/analyticsPhase2";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface VisitRow {
  actor_type: "parent" | "child";
  actor_id: string | null;
  child_id: string | null;
  family_id: string | null;
  occurred_at: string;
}

interface VisitPoint extends VisitRow { unitId: string; date: string; familyId: string }

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
        .select("actor_type,actor_id,child_id,family_id,occurred_at")
        .eq("event_name", "app_session_start").eq("feature", "app_session"), { column: "occurred_at", uniqueColumn: "id" }),
    ]);
    const identity = settledValue(settled[0], "분석 대상");
    const points: VisitPoint[] = settledValue(settled[1], "방문 이벤트").flatMap((row) => {
      if (row.actor_type === "parent" && row.actor_id && identity.parentIds.has(row.actor_id)) {
        const familyId = identity.parentFamily.get(row.actor_id);
        return familyId ? [{ ...row, unitId: `parent:${row.actor_id}`, familyId, date: kstDateOfTimestamp(row.occurred_at) }] : [];
      }
      if (row.actor_type === "child" && row.child_id && identity.childIds.has(row.child_id)) {
        const familyId = identity.childFamily.get(row.child_id);
        return familyId ? [{ ...row, unitId: `child:${row.child_id}`, familyId, date: kstDateOfTimestamp(row.occurred_at) }] : [];
      }
      return [];
    });
    const measuredFrom = points.length > 0 ? points.map((point) => point.date).sort()[0] : null;
    const scoped = points.filter((point) => filters.scope === "all" || filters.scope === "family"
      || (filters.scope === "parent" && point.actor_type === "parent")
      || (filters.scope === "child" && point.actor_type === "child"));
    const unitsBetween = (from: string, to: string) => new Set(scoped.filter((point) => point.date >= from && point.date <= to).map((point) => point.unitId)).size;
    const covered = (from: string) => measuredFrom !== null && measuredFrom <= from;
    const countMetric = (from: string, to: string, reason: string) => covered(from)
      ? readyMetric(unitsBetween(from, to), measuredFrom)
      : accumulatingMetric<number>(measuredFrom, reason);
    const dauStart = filters.to;
    const wauStart = offsetCalendarDate(filters.to, -6);
    const mauStart = offsetCalendarDate(filters.to, -29);

    const selected = points.filter((point) => point.date >= filters.from && point.date <= filters.to);
    const families = new Map<string, { parent: boolean; child: boolean }>();
    for (const point of selected) {
      const state = families.get(point.familyId) ?? { parent: false, child: false };
      if (point.actor_type === "parent") state.parent = true;
      if (point.actor_type === "child") state.child = true;
      families.set(point.familyId, state);
    }
    const familyCoverage = covered(filters.from);
    const familyMetric = (predicate: (value: { parent: boolean; child: boolean }) => boolean) => familyCoverage
      ? readyMetric([...families.values()].filter(predicate).length, measuredFrom)
      : accumulatingMetric<number>(measuredFrom, "선택 기간 전체의 방문 계측이 아직 쌓이지 않았습니다.");

    const stickinessStart = wauStart;
    const datesByUnit = new Map<string, Set<string>>();
    for (const point of scoped.filter((item) => item.date >= stickinessStart && item.date <= filters.to)) {
      const dates = datesByUnit.get(point.unitId) ?? new Set<string>();
      dates.add(point.date);
      datesByUnit.set(point.unitId, dates);
    }
    const stickiness = covered(stickinessStart) ? {
      status: "ready",
      onceOrLess: [...datesByUnit.values()].filter((dates) => dates.size <= 1).length,
      twoToThree: [...datesByUnit.values()].filter((dates) => dates.size >= 2 && dates.size <= 3).length,
      fourToSix: [...datesByUnit.values()].filter((dates) => dates.size >= 4 && dates.size <= 6).length,
      daily: [...datesByUnit.values()].filter((dates) => dates.size === 7).length,
    } : { status: "accumulating", onceOrLess: null, twoToThree: null, fourToSix: null, daily: null };

    const periodDays = calendarDayDiff(filters.from, filters.to) + 1;
    const previousFrom = offsetCalendarDate(filters.from, -periodDays);
    const previousTo = offsetCalendarDate(filters.from, -1);
    const currentUnits = new Set(scoped.filter((point) => point.date >= filters.from && point.date <= filters.to).map((point) => point.unitId));
    const previousUnits = new Set(scoped.filter((point) => point.date >= previousFrom && point.date <= previousTo).map((point) => point.unitId));
    const historicUnits = new Set(scoped.filter((point) => point.date < previousFrom).map((point) => point.unitId));
    const firstDateByUnit = new Map<string, string>();
    for (const point of scoped) {
      const previous = firstDateByUnit.get(point.unitId);
      if (!previous || point.date < previous) firstDateByUnit.set(point.unitId, point.date);
    }
    const lifecycleReady = covered(previousFrom);
    const lifecycle = lifecycleReady ? {
      status: "ready",
      new: [...currentUnits].filter((unit) => (firstDateByUnit.get(unit) ?? "") >= filters.from).length,
      continuing: [...currentUnits].filter((unit) => previousUnits.has(unit)).length,
      returning: [...currentUnits].filter((unit) => !previousUnits.has(unit) && historicUnits.has(unit)).length,
      dormant: [...new Set([...previousUnits, ...historicUnits])].filter((unit) => !currentUnits.has(unit)).length,
    } : { status: "accumulating", new: null, continuing: null, returning: null, dormant: null };

    const trendByDate = new Map<string, { parent: Set<string>; child: Set<string> }>();
    for (const point of points) {
      if (point.date < filters.from || point.date > filters.to) continue;
      const day = trendByDate.get(point.date) ?? { parent: new Set<string>(), child: new Set<string>() };
      day[point.actor_type].add(point.unitId);
      trendByDate.set(point.date, day);
    }
    const trend = enumerateCalendarDates(filters.from, filters.to).map((date) => {
      const day = trendByDate.get(date);
      return {
        date,
        parent: covered(date) ? day?.parent.size ?? 0 : null,
        child: covered(date) ? day?.child.size ?? 0 : null,
      };
    });
    const dau = countMetric(dauStart, filters.to, "오늘 방문 데이터가 아직 계측되지 않았습니다.");
    const wau = countMetric(wauStart, filters.to, "최근 7일 방문 데이터가 모두 쌓이지 않았습니다.");
    const mau = countMetric(mauStart, filters.to, "최근 30일 방문 데이터가 모두 쌓이지 않았습니다.");

    return NextResponse.json({
      filters,
      coverage: { measuredFrom, status: covered(filters.from) ? "ready" : measuredFrom ? "accumulating" : "not_started", source: "behavior_events.app_session_start" },
      activeUsers: { dau, wau, mau, wauToMau: wau.value !== null && mau.value !== null ? readyMetric(roundRate(wau.value, mau.value), measuredFrom) : accumulatingMetric<number>(measuredFrom, "WAU/MAU 계측 기간이 아직 완성되지 않았습니다.") },
      families: {
        bothVisited: familyMetric((value) => value.parent && value.child),
        parentOnly: familyMetric((value) => value.parent && !value.child),
        childOnly: familyMetric((value) => !value.parent && value.child),
        notVisited: familyCoverage ? readyMetric(Math.max(0, identity.familyIds.size - families.size), measuredFrom) : accumulatingMetric<number>(measuredFrom, "선택 기간 전체의 방문 계측이 아직 쌓이지 않았습니다."),
      },
      stickiness,
      lifecycle,
      trend,
      meta: { noLastSignInAt: true, generatedAt: new Date().toISOString() },
    });
  } catch (error) {
    console.error("[admin/analytics/visits] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "방문 집계에 실패했습니다." }, { status: 500 });
  }
}
