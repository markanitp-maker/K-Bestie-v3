export type ParentTemporalKind = "EXACT_DATE" | "DATE_RANGE" | "RECENT" | "LONG_TERM" | "NONE";
export type ParentTemporalMatch = "EXACT" | "RANGE" | "RECENT" | "LONG_TERM" | "NONE" | "MISMATCH";

export interface ParentDateRange {
  from: string;
  to: string;
}

export interface ParentTemporalResolution {
  kind: ParentTemporalKind;
  timeZone: "Asia/Seoul";
  targetDate: string | null;
  dateRange: ParentDateRange | null;
  label: string | null;
  inherited: boolean;
}

interface ResolveTemporalOptions {
  now?: Date;
  inherited?: ParentTemporalResolution | null;
}

const KST_TIME_ZONE = "Asia/Seoul" as const;
const DATE_TOKEN = /(?:\d{4}-\d{2}-\d{2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일|\d{1,2}월\s*\d{1,2}일|오늘|어제|그제|그저께|내일|이번\s*주|지난\s*주|저번\s*주|다음\s*주|이번\s*달|지난\s*달|저번\s*달|요즘|최근|평소|원래|예전부터|자주)/;
const INHERIT_DATE_PATTERN = /그날|그\s*날|그때|그\s*때|그\s*주|그\s*달/;
const NEGATION_SPLIT_PATTERN = /(?:이\s*아니라|아니라|아니고|말고|대신)/g;

function extractNegationTarget(text: string): string {
  let match: RegExpExecArray | null;
  let lastMatch: RegExpExecArray | null = null;
  while ((match = NEGATION_SPLIT_PATTERN.exec(text)) !== null) {
    lastMatch = match;
  }
  if (!lastMatch) return text;

  const before = text.slice(0, lastMatch.index).trim();
  const after = text.slice(lastMatch.index + lastMatch[0].length).trim();

  if (before.length > 0 && after.length > 0) {
    return after;
  }
  return text;
}

function kstParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function calendarDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function startOfWeek(date: Date): Date {
  const day = date.getUTCDay();
  return addDays(date, -(day === 0 ? 6 : day - 1));
}

function endOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0));
}

function exact(targetDate: string, label: string, inherited = false): ParentTemporalResolution {
  return { kind: "EXACT_DATE", timeZone: KST_TIME_ZONE, targetDate, dateRange: null, label, inherited };
}

function range(dateRange: ParentDateRange, label: string, inherited = false): ParentTemporalResolution {
  return { kind: "DATE_RANGE", timeZone: KST_TIME_ZONE, targetDate: null, dateRange, label, inherited };
}

function cloneInherited(value: ParentTemporalResolution): ParentTemporalResolution {
  return { ...value, dateRange: value.dateRange ? { ...value.dateRange } : null, inherited: true };
}

export function resolveParentTemporalQuery(query: string, options: ResolveTemporalOptions = {}): ParentTemporalResolution {
  const now = options.now ?? new Date();
  const { year, month, day } = kstParts(now);
  const today = calendarDate(year, month, day);
  const normalized = query.normalize("NFKC").replace(/\s+/g, " ").trim();
  const target = extractNegationTarget(normalized);

  const iso = target.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return exact(formatDate(calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))), iso[0]);

  const fullKorean = target.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (fullKorean) {
    return exact(formatDate(calendarDate(Number(fullKorean[1]), Number(fullKorean[2]), Number(fullKorean[3]))), fullKorean[0]);
  }

  const monthDay = target.match(/(?<!\d)(\d{1,2})월\s*(\d{1,2})일/);
  if (monthDay) return exact(formatDate(calendarDate(year, Number(monthDay[1]), Number(monthDay[2]))), monthDay[0]);

  if (/그저께|그제/.test(target)) return exact(formatDate(addDays(today, -2)), "그제");
  if (/어제/.test(target)) return exact(formatDate(addDays(today, -1)), "어제");
  if (/오늘/.test(target)) return exact(formatDate(today), "오늘");
  if (/내일/.test(target)) return exact(formatDate(addDays(today, 1)), "내일");

  const weekStart = startOfWeek(today);
  if (/지난\s*주|저번\s*주/.test(target)) {
    const from = addDays(weekStart, -7);
    return range({ from: formatDate(from), to: formatDate(addDays(from, 6)) }, "지난주");
  }
  if (/다음\s*주/.test(target)) {
    const from = addDays(weekStart, 7);
    return range({ from: formatDate(from), to: formatDate(addDays(from, 6)) }, "다음 주");
  }
  if (/이번\s*주|이번주/.test(target)) {
    return range({ from: formatDate(weekStart), to: formatDate(addDays(weekStart, 6)) }, "이번 주");
  }

  if (/지난\s*달|저번\s*달/.test(target)) {
    const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));
    const previousMonthStart = calendarDate(previousMonthEnd.getUTCFullYear(), previousMonthEnd.getUTCMonth() + 1, 1);
    return range({ from: formatDate(previousMonthStart), to: formatDate(previousMonthEnd) }, "지난달");
  }
  if (/이번\s*달|이번달/.test(target)) {
    return range({ from: formatDate(calendarDate(year, month, 1)), to: formatDate(endOfMonth(year, month)) }, "이번 달");
  }

  if (/요즘|최근/.test(target)) {
    return {
      kind: "RECENT",
      timeZone: KST_TIME_ZONE,
      targetDate: null,
      dateRange: { from: formatDate(addDays(today, -13)), to: formatDate(today) },
      label: /요즘/.test(target) ? "요즘" : "최근",
      inherited: false,
    };
  }

  if (/평소|원래|예전부터|자주/.test(target)) {
    return { kind: "LONG_TERM", timeZone: KST_TIME_ZONE, targetDate: null, dateRange: null, label: "평소", inherited: false };
  }

  if (options.inherited && (INHERIT_DATE_PATTERN.test(target) || !DATE_TOKEN.test(target))) {
    return cloneInherited(options.inherited);
  }

  return { kind: "NONE", timeZone: KST_TIME_ZONE, targetDate: null, dateRange: null, label: null, inherited: false };
}

export function resolveTemporalFromUserContext(
  query: string,
  context: Array<{ role: "user" | "k"; text: string }>,
  now = new Date(),
): ParentTemporalResolution {
  const inherited = [...context]
    .reverse()
    .filter((turn) => turn.role === "user")
    .map((turn) => resolveParentTemporalQuery(turn.text, { now }))
    .find((resolution) => resolution.kind !== "NONE") ?? null;
  return resolveParentTemporalQuery(query, { now, inherited });
}

function datesFromEvidenceDate(value: string): string[] {
  return value.match(/20\d{2}-\d{2}-\d{2}/g) ?? [];
}

export function temporalMatchForEvidence(date: string, temporal: ParentTemporalResolution): ParentTemporalMatch {
  const dates = datesFromEvidenceDate(date);
  if (temporal.kind === "EXACT_DATE") return dates.includes(temporal.targetDate ?? "") ? "EXACT" : "MISMATCH";
  if ((temporal.kind === "DATE_RANGE" || temporal.kind === "RECENT") && temporal.dateRange) {
    const overlaps = dates.some((value) => value >= temporal.dateRange!.from && value <= temporal.dateRange!.to);
    if (!overlaps) return "MISMATCH";
    return temporal.kind === "RECENT" ? "RECENT" : "RANGE";
  }
  if (temporal.kind === "LONG_TERM") return "LONG_TERM";
  return "NONE";
}

export function parentSourcePriority(kind: ParentTemporalKind, source: string): number {
  const priorities: Record<ParentTemporalKind, string[]> = {
    EXACT_DATE: ["daily_report", "dashboard", "detailed_report", "weekly_report", "memory_fact"],
    DATE_RANGE: ["weekly_report", "daily_report", "dashboard", "detailed_report", "memory_fact"],
    RECENT: ["daily_report", "dashboard", "weekly_report", "detailed_report", "memory_fact"],
    LONG_TERM: ["memory_fact", "weekly_report", "daily_report", "dashboard", "detailed_report"],
    NONE: ["daily_report", "dashboard", "weekly_report", "detailed_report", "memory_fact"],
  };
  const index = priorities[kind].indexOf(source);
  return index < 0 ? priorities[kind].length : index;
}
