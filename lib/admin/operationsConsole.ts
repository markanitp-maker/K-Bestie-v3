import { getOffsetDateStr, toKSTDateStr } from "@/lib/analytics/kstDate";

export type OperationsTab = "push" | "acquisition" | "trash" | "issues";
export type AcquisitionSubTab = "dashboard" | "links";
export type AcquisitionPeriod = "today" | "7d" | "14d" | "30d" | "month" | "last_month" | "all" | "custom";

export interface AcquisitionSharedState {
  period: AcquisitionPeriod;
  attribution: "signup" | "first";
  includeTestAccounts: boolean;
  channelFilter: string;
  startDate: string;
  endDate: string;
}

export interface OperationsLocationState {
  tab: OperationsTab;
  sub: AcquisitionSubTab;
  acquisition: AcquisitionSharedState;
}

const TABS = new Set<OperationsTab>(["push", "acquisition", "trash", "issues"]);
const SUB_TABS = new Set<AcquisitionSubTab>(["dashboard", "links"]);
const PERIODS = new Set<AcquisitionPeriod>(["today", "7d", "14d", "30d", "month", "last_month", "all", "custom"]);

export interface AcquisitionPeriodRange {
  fromIso: string | null;
  toIso: string;
  startDate: string | null;
  endDate: string;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function previousMonthStart(date: string): string {
  const [year, month] = date.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function resolveAcquisitionPeriodRange(input: {
  period: AcquisitionPeriod;
  startDate?: string | null;
  endDate?: string | null;
  now?: Date;
}): AcquisitionPeriodRange {
  const today = toKSTDateStr((input.now ?? new Date()).toISOString());
  let startDate: string | null;
  let endDate = today;

  switch (input.period) {
    case "today": startDate = today; break;
    case "7d": startDate = getOffsetDateStr(today, -6); break;
    case "14d": startDate = getOffsetDateStr(today, -13); break;
    case "30d": startDate = getOffsetDateStr(today, -29); break;
    case "month": startDate = monthStart(today); break;
    case "last_month": {
      startDate = previousMonthStart(today);
      endDate = getOffsetDateStr(monthStart(today), -1);
      break;
    }
    case "all": startDate = null; break;
    case "custom": {
      if (!input.startDate || !input.endDate || !validDate(input.startDate) || !validDate(input.endDate)) {
        throw new Error("사용자 지정 기간이 올바르지 않습니다.");
      }
      if (input.startDate > input.endDate) throw new Error("시작일은 종료일보다 늦을 수 없습니다.");
      startDate = input.startDate;
      endDate = input.endDate;
      break;
    }
  }

  return {
    fromIso: startDate ? `${startDate}T00:00:00.000+09:00` : null,
    toIso: `${endDate}T23:59:59.999+09:00`,
    startDate,
    endDate,
  };
}

export function parseOperationsLocation(searchParams: URLSearchParams): OperationsLocationState {
  const rawTab = searchParams.get("tab") as OperationsTab | null;
  const rawSub = searchParams.get("sub") as AcquisitionSubTab | null;
  const rawPeriod = searchParams.get("period") as AcquisitionPeriod | null;
  const rawAttribution = searchParams.get("attribution");

  return {
    tab: rawTab && TABS.has(rawTab) ? rawTab : "push",
    sub: rawSub && SUB_TABS.has(rawSub) ? rawSub : "dashboard",
    acquisition: {
      period: rawPeriod && PERIODS.has(rawPeriod) ? rawPeriod : "30d",
      attribution: rawAttribution === "first" ? "first" : "signup",
      includeTestAccounts: searchParams.get("includeTestAccounts") === "true",
      channelFilter: searchParams.get("channel") ?? "",
      startDate: searchParams.get("startDate") ?? "",
      endDate: searchParams.get("endDate") ?? "",
    },
  };
}

export function buildOperationsHref(state: OperationsLocationState): string {
  const params = new URLSearchParams({ tab: state.tab });
  if (state.tab === "acquisition") {
    params.set("sub", state.sub);
    params.set("period", state.acquisition.period);
    params.set("attribution", state.acquisition.attribution);
    if (state.acquisition.includeTestAccounts) params.set("includeTestAccounts", "true");
    if (state.acquisition.channelFilter) params.set("channel", state.acquisition.channelFilter);
    if (state.acquisition.period === "custom") {
      if (state.acquisition.startDate) params.set("startDate", state.acquisition.startDate);
      if (state.acquisition.endDate) params.set("endDate", state.acquisition.endDate);
    }
  }
  return `/admin/operations?${params.toString()}`;
}
