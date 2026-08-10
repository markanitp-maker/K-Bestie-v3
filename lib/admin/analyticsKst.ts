export const ANALYTICS_TIMEZONE = "Asia/Seoul" as const;

export type AnalyticsPeriod = "today" | "7d" | "14d" | "30d" | "month" | "lastmonth" | "custom";
export type AnalyticsScope = "all" | "family" | "parent" | "child";
export type InternalTestMode = "exclude" | "include" | "only";

export interface AnalyticsKstFilters {
  period: AnalyticsPeriod;
  scope: AnalyticsScope;
  internalTest: InternalTestMode;
  channel: string | null;
  from: string;
  to: string;
  fromIso: string;
  toExclusiveIso: string;
  timezone: typeof ANALYTICS_TIMEZONE;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODS: AnalyticsPeriod[] = ["today", "7d", "14d", "30d", "month", "lastmonth", "custom"];
const SCOPES: AnalyticsScope[] = ["all", "family", "parent", "child"];
const INTERNAL_TEST_MODES: InternalTestMode[] = ["exclude", "include", "only"];
const MAX_CUSTOM_DAYS = 366;

export function isAnalyticsCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function offsetCalendarDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function toKstCalendarDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("유효하지 않은 날짜입니다.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ANALYTICS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function kstDayStartIso(date: string): string {
  if (!isAnalyticsCalendarDate(date)) throw new Error("유효하지 않은 KST 날짜입니다.");
  return new Date(`${date}T00:00:00+09:00`).toISOString();
}

export function kstDayEndExclusiveIso(date: string): string {
  return kstDayStartIso(offsetCalendarDate(date, 1));
}

export function kstDateOfTimestamp(timestamp: string): string {
  return toKstCalendarDate(timestamp);
}

export function calendarDayDiff(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function enumerateCalendarDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let current = from; current <= to; current = offsetCalendarDate(current, 1)) dates.push(current);
  return dates;
}

export function resolveAnalyticsKstFilters(
  params: URLSearchParams,
  now: Date = new Date(),
): AnalyticsKstFilters {
  const today = toKstCalendarDate(now);
  const rawPeriod = params.get("period");
  const period = PERIODS.includes(rawPeriod as AnalyticsPeriod) ? rawPeriod as AnalyticsPeriod : "7d";
  const rawScope = params.get("scope");
  const scope = SCOPES.includes(rawScope as AnalyticsScope) ? rawScope as AnalyticsScope : "all";
  const rawInternalTest = params.get("internalTest");
  const internalTest = INTERNAL_TEST_MODES.includes(rawInternalTest as InternalTestMode)
    ? rawInternalTest as InternalTestMode
    : "exclude";
  const rawChannel = params.get("channel")?.trim() ?? "";
  const channel = rawChannel && rawChannel !== "all" ? rawChannel.slice(0, 100) : null;

  let from = offsetCalendarDate(today, -6);
  let to = today;
  if (period === "today") from = today;
  if (period === "14d") from = offsetCalendarDate(today, -13);
  if (period === "30d") from = offsetCalendarDate(today, -29);
  if (period === "month") from = `${today.slice(0, 7)}-01`;
  if (period === "lastmonth") {
    to = offsetCalendarDate(`${today.slice(0, 7)}-01`, -1);
    from = `${to.slice(0, 7)}-01`;
  }
  if (period === "custom") {
    const requestedFrom = params.get("from") ?? params.get("startDate") ?? "";
    const requestedTo = params.get("to") ?? params.get("endDate") ?? "";
    if (!isAnalyticsCalendarDate(requestedFrom) || !isAnalyticsCalendarDate(requestedTo) || requestedFrom > requestedTo) {
      throw new Error("직접 기간의 시작일과 종료일을 확인해 주세요.");
    }
    if (calendarDayDiff(requestedFrom, requestedTo) > MAX_CUSTOM_DAYS) {
      throw new Error("직접 기간은 최대 366일까지 조회할 수 있습니다.");
    }
    from = requestedFrom;
    to = requestedTo;
  }

  return {
    period,
    scope,
    internalTest,
    channel,
    from,
    to,
    fromIso: kstDayStartIso(from),
    toExclusiveIso: kstDayEndExclusiveIso(to),
    timezone: ANALYTICS_TIMEZONE,
  };
}

