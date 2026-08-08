export type OperationsTab = "push" | "acquisition" | "trash";
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

const TABS = new Set<OperationsTab>(["push", "acquisition", "trash"]);
const SUB_TABS = new Set<AcquisitionSubTab>(["dashboard", "links"]);
const PERIODS = new Set<AcquisitionPeriod>(["today", "7d", "14d", "30d", "month", "last_month", "all", "custom"]);

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
