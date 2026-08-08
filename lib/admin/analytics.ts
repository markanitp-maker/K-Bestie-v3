import { getOffsetDateStr } from "@/lib/analytics/kstDate";

export type AnalyticsPeriod = "today" | "7d" | "14d" | "30d" | "month" | "lastmonth" | "custom";
export type AnalyticsScope = "all" | "family" | "parent" | "child";
export type InternalTestMode = "exclude" | "include" | "only";

export interface AnalyticsFilters {
  period: AnalyticsPeriod;
  scope: AnalyticsScope;
  internalTest: InternalTestMode;
  from: string;
  to: string;
  timezone: "Asia/Seoul";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function resolveAnalyticsFilters(params: URLSearchParams, todayStr: string): AnalyticsFilters {
  const rawPeriod = params.get("period");
  const period: AnalyticsPeriod = ["today", "7d", "14d", "30d", "month", "lastmonth", "custom"].includes(rawPeriod ?? "")
    ? rawPeriod as AnalyticsPeriod
    : "7d";
  const rawScope = params.get("scope");
  const scope: AnalyticsScope = ["all", "family", "parent", "child"].includes(rawScope ?? "")
    ? rawScope as AnalyticsScope
    : "all";
  const rawInternal = params.get("internalTest");
  const internalTest: InternalTestMode = ["exclude", "include", "only"].includes(rawInternal ?? "")
    ? rawInternal as InternalTestMode
    : "exclude";

  let from = getOffsetDateStr(todayStr, -6);
  let to = todayStr;
  if (period === "today") from = todayStr;
  if (period === "14d") from = getOffsetDateStr(todayStr, -13);
  if (period === "30d") from = getOffsetDateStr(todayStr, -29);
  if (period === "month") from = `${todayStr.slice(0, 7)}-01`;
  if (period === "lastmonth") {
    const currentMonthStart = `${todayStr.slice(0, 7)}-01`;
    to = getOffsetDateStr(currentMonthStart, -1);
    from = `${to.slice(0, 7)}-01`;
  }
  if (period === "custom") {
    const requestedFrom = params.get("from") ?? "";
    const requestedTo = params.get("to") ?? "";
    if (!isCalendarDate(requestedFrom) || !isCalendarDate(requestedTo) || requestedFrom > requestedTo) {
      throw new Error("직접 기간의 시작일과 종료일을 확인해 주세요.");
    }
    from = requestedFrom;
    to = requestedTo;
  }

  return { period, scope, internalTest, from, to, timezone: "Asia/Seoul" };
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

const RETENTION_KEYS = ["d1", "d3", "d7", "d14", "w2"] as const;

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

export function filterCohortsByRange(payload: any, from: string, to: string) {
  const cohorts = (Array.isArray(payload?.cohorts) ? payload.cohorts : []).filter((row: any) => {
    const date = String(row?.cohortWeekStart ?? "");
    return date >= from && date <= to;
  });
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
    { key: "d3", label: "D3 리텐션", value: cohort.d3?.rate == null ? null : Math.round(cohort.d3.rate * 1000) / 10, unit: "percent", numerator: cohort.d3?.numerator, denominator: cohort.d3?.denominator },
    { key: "d7", label: "D7 리텐션", value: cohort.d7?.rate == null ? null : Math.round(cohort.d7.rate * 1000) / 10, unit: "percent", numerator: cohort.d7?.numerator, denominator: cohort.d7?.denominator },
    { key: "dualFamilies", label: "부모 동시 활성 가족", value: Number(overview.dualActivationFamilies?.value ?? 0), unit: "count" },
  ];
}
