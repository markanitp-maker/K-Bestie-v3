import {
  isAnalyticsCalendarDate,
  resolveAnalyticsKstFilters,
  type AnalyticsPeriod,
  type AnalyticsScope,
  type InternalTestMode,
} from "@/lib/admin/analyticsKst";

export type { AnalyticsPeriod, AnalyticsScope, InternalTestMode } from "@/lib/admin/analyticsKst";

export interface AnalyticsFilters {
  period: AnalyticsPeriod;
  scope: AnalyticsScope;
  internalTest: InternalTestMode;
  from: string;
  to: string;
  timezone: "Asia/Seoul";
}

export function isCalendarDate(value: string): boolean {
  return isAnalyticsCalendarDate(value);
}

export function resolveAnalyticsFilters(params: URLSearchParams, todayStr: string): AnalyticsFilters {
  const resolved = resolveAnalyticsKstFilters(params, new Date(`${todayStr}T03:00:00+09:00`));
  return {
    period: resolved.period,
    scope: resolved.scope,
    internalTest: resolved.internalTest,
    from: resolved.from,
    to: resolved.to,
    timezone: resolved.timezone,
  };
}

export function retentionParams(filters: AnalyticsFilters, includeTestAccounts: boolean): URLSearchParams {
  return new URLSearchParams({
    period: filters.period === "lastmonth" ? "custom" : filters.period,
    from: filters.from,
    to: filters.to,
    includeTestAccounts: String(includeTestAccounts),
  });
}

function subtractNumber(include: unknown, exclude: unknown): number {
  return Math.max(0, Number(include ?? 0) - Number(exclude ?? 0));
}

function subtractKpi(include: any, exclude: any) {
  const value = subtractNumber(include?.value, exclude?.value);
  const prevValue = subtractNumber(include?.prevValue, exclude?.prevValue);
  return {
    value,
    prevValue,
    deltaPct: prevValue > 0 ? Math.round(((value - prevValue) / prevValue) * 1000) / 10 : null,
  };
}

export function subtractOverview(include: any, exclude: any) {
  const kpis: Record<string, ReturnType<typeof subtractKpi>> = {};
  for (const key of new Set([...Object.keys(include?.kpis ?? {}), ...Object.keys(exclude?.kpis ?? {})])) {
    kpis[key] = subtractKpi(include?.kpis?.[key], exclude?.kpis?.[key]);
  }
  const excludedTrend = new Map((Array.isArray(exclude?.dailyTrend) ? exclude.dailyTrend : []).map((row: any) => [row.date, row]));
  const dailyTrend = (Array.isArray(include?.dailyTrend) ? include.dailyTrend : []).map((row: any) => {
    const other: any = excludedTrend.get(row.date) ?? {};
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key === "date" ? value : subtractNumber(value, other[key])]));
  });
  return { ...include, kpis, dailyTrend, todayActivity: [], meta: { ...(include?.meta ?? {}), internalTestMode: "only" } };
}

type RetentionMetric = { numerator: number; denominator: number; rate: number | null };

function subtractMetric(include: any, exclude: any): RetentionMetric {
  const numerator = subtractNumber(include?.numerator, exclude?.numerator);
  const denominator = subtractNumber(include?.denominator, exclude?.denominator);
  return { numerator, denominator, rate: denominator > 0 ? numerator / denominator : null };
}

export const RETENTION_KEYS = ["d1", "d3", "d7", "d14", "d30", "w1", "w2", "w4"] as const;

export function isCohortDateInRange(cohortDateStr: string, from?: string | null, to?: string | null): boolean {
  if (!cohortDateStr) return false;
  if (from && cohortDateStr < from) return false;
  if (to && cohortDateStr > to) return false;
  return true;
}

export function summarizeCohorts(cohorts: any[]): Record<string, RetentionMetric> {
  const summary: Record<string, RetentionMetric> = {};
  for (const key of RETENTION_KEYS) {
    let numerator = 0;
    let denominator = 0;
    for (const cohort of cohorts) {
      numerator += Number(cohort?.[key]?.numerator ?? 0);
      denominator += Number(cohort?.[key]?.denominator ?? 0);
    }
    summary[key] = { numerator, denominator, rate: denominator > 0 ? numerator / denominator : null };
  }
  return summary;
}

export function filterCohortsByRange(payload: any, _from?: string, _to?: string) {
  // cohort route에서 개별 사용자 가입일(cohortDateStr) 기준으로 필터링하므로
  // 주차(cohortWeekStart)로 자르지 않고 payload를 통과시키며 summary 정합성을 유지합니다.
  const cohorts = Array.isArray(payload?.cohorts) ? payload.cohorts : [];
  return { ...payload, cohorts, summary: summarizeCohorts(cohorts) };
}

export function subtractCohorts(include: any, exclude: any) {
  const excluded = new Map((Array.isArray(exclude?.cohorts) ? exclude.cohorts : []).map((row: any) => [row.cohortWeekStart, row]));
  const cohorts = (Array.isArray(include?.cohorts) ? include.cohorts : []).map((row: any) => {
    const other: any = excluded.get(row.cohortWeekStart) ?? {};
    const next: any = { ...row, size: subtractNumber(row.size, other.size) };
    for (const key of RETENTION_KEYS) next[key] = subtractMetric(row[key], other[key]);
    return next;
  }).filter((row: any) => row.size > 0);
  return { ...include, cohorts, summary: summarizeCohorts(cohorts), meta: { ...(include?.meta ?? {}), internalTestMode: "only" } };
}

export function subtractRows(include: any[], exclude: any[], idKeys: string[]): any[] {
  const identity = (row: any) => idKeys.map((key) => String(row?.[key] ?? "")).join(":");
  const excluded = new Set((Array.isArray(exclude) ? exclude : []).map(identity));
  return (Array.isArray(include) ? include : []).filter((row) => !excluded.has(identity(row)));
}

export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export interface AnalyticsKpi {
  key: string;
  label: string;
  value: number | null;
  unit: "count" | "percent";
  numerator?: number;
  denominator?: number;
}

export function buildAnalyticsKpis(payload: any): AnalyticsKpi[] {
  const overview = payload?.retention?.overview?.kpis ?? {};
  const reporting = payload?.reporting?.kpis ?? {};
  const cohort = payload?.retention?.cohort?.summary ?? {};
  const scope: AnalyticsScope = payload?.filters?.scope ?? "all";
  const activeUsers = scope === "family"
    ? Number(overview.activeFamilies?.value ?? 0)
    : scope === "parent"
      ? Number(overview.activeParents?.value ?? 0)
      : scope === "child"
        ? Number(overview.activeChildren?.value ?? 0)
        : Number(overview.activeParents?.value ?? 0) + Number(overview.activeChildren?.value ?? 0);
  const activeLabel = scope === "family" ? "활성 가족(선택 범위)" : scope === "parent" ? "활성 부모" : scope === "child" ? "활성 아이" : "전체 활성 사용자";
  return [
    { key: "activeUsers", label: activeLabel, value: activeUsers, unit: "count" },
    { key: "activeFamilies", label: "활성 가족", value: Number(overview.activeFamilies?.value ?? 0), unit: "count" },
    { key: "missionCompletionRate", label: "미션 완료율", value: reporting.missionCompletionRate ?? null, unit: "percent", numerator: reporting.missionCompletes, denominator: reporting.missionStarts },
    { key: "reportGenerationRate", label: "리포트 생성률", value: reporting.reportGenerationRate ?? null, unit: "percent", numerator: reporting.reportGeneratedUsers, denominator: reporting.reportTargetUsers },
    { key: "d1", label: "D1 리텐션", value: cohort.d1?.rate == null ? null : Math.round(cohort.d1.rate * 1000) / 10, unit: "percent", numerator: cohort.d1?.numerator, denominator: cohort.d1?.denominator },
    { key: "d7", label: "D7 리텐션", value: cohort.d7?.rate == null ? null : Math.round(cohort.d7.rate * 1000) / 10, unit: "percent", numerator: cohort.d7?.numerator, denominator: cohort.d7?.denominator },
    { key: "d30", label: "D30 리텐션", value: cohort.d30?.rate == null ? null : Math.round(cohort.d30.rate * 1000) / 10, unit: "percent", numerator: cohort.d30?.numerator, denominator: cohort.d30?.denominator },
    { key: "dualFamilies", label: "부모 동시 활성 가족", value: Number(overview.dualActivationFamilies?.value ?? 0), unit: "count" },
  ];
}
