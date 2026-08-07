export const BILLING_TIMEZONE = "Asia/Seoul";
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type BillingPeriod = "today" | "7d" | "month" | "last_month" | "custom";

export interface BillingPeriodRange {
  period: BillingPeriod;
  from: Date;
  to: Date;
  startDate: string;
  endDate: string;
  days: number;
  timezone: typeof BILLING_TIMEZONE;
}

export class BillingPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingPeriodError";
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(value: string): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(value);
  if (!match) throw new BillingPeriodError("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new BillingPeriodError("유효하지 않은 날짜입니다.");
  }
  return { year, month, day };
}

export function kstDateToUtc(value: string): Date {
  const { year, month, day } = parseDate(value);
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
}

export function formatKstDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function formatKstDateTime(value: Date | string | null): string | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: BILLING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function addCalendarDays(value: string, amount: number): string {
  const { year, month, day } = parseDate(value);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function firstOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function addMonths(value: string, amount: number): string {
  const { year, month } = parseDate(value);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function inclusiveDays(startDate: string, endDate: string): number {
  return Math.round((kstDateToUtc(addCalendarDays(endDate, 1)).getTime() - kstDateToUtc(startDate).getTime()) / 86_400_000);
}

export function resolveBillingPeriodRange(input: {
  period: string | null;
  startDate?: string | null;
  endDate?: string | null;
  now?: Date;
}): BillingPeriodRange {
  const period = input.period ?? "month";
  if (!(["today", "7d", "month", "last_month", "custom"] as string[]).includes(period)) {
    throw new BillingPeriodError("지원하지 않는 기간입니다.");
  }

  const now = input.now ? new Date(input.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new BillingPeriodError("현재 시각이 유효하지 않습니다.");
  const today = formatKstDate(now);
  let startDate: string;
  let endDate: string;
  let to: Date;

  if (period === "today") {
    startDate = today;
    endDate = today;
    to = now;
  } else if (period === "7d") {
    startDate = addCalendarDays(today, -6);
    endDate = today;
    to = now;
  } else if (period === "month") {
    startDate = firstOfMonth(today);
    endDate = today;
    to = now;
  } else if (period === "last_month") {
    const thisMonth = firstOfMonth(today);
    startDate = addMonths(thisMonth, -1);
    const nextMonth = thisMonth;
    endDate = addCalendarDays(nextMonth, -1);
    to = kstDateToUtc(nextMonth);
  } else {
    if (!input.startDate || !input.endDate) {
      throw new BillingPeriodError("직접 기간의 시작일과 종료일은 필수입니다.");
    }
    parseDate(input.startDate);
    parseDate(input.endDate);
    if (input.startDate > input.endDate) {
      throw new BillingPeriodError("시작일은 종료일보다 늦을 수 없습니다.");
    }
    if (input.endDate > today) {
      throw new BillingPeriodError("종료일은 오늘 이후일 수 없습니다.");
    }
    startDate = input.startDate;
    endDate = input.endDate;
    to = endDate === today ? now : kstDateToUtc(addCalendarDays(endDate, 1));
  }

  return {
    period: period as BillingPeriod,
    from: kstDateToUtc(startDate),
    to,
    startDate,
    endDate,
    days: inclusiveDays(startDate, endDate),
    timezone: BILLING_TIMEZONE,
  };
}

export function prorateMonthlyCost(monthlyKrw: number, range: Pick<BillingPeriodRange, "startDate" | "endDate">): number {
  let cursor = range.startDate;
  let total = 0;
  while (cursor <= range.endDate) {
    const { year, month } = parseDate(cursor);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    total += monthlyKrw / daysInMonth;
    cursor = addCalendarDays(cursor, 1);
  }
  return total;
}
