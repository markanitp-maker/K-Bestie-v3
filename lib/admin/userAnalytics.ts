import { toKSTDateStr, getOffsetDateStr } from "@/lib/analytics/kstDate";
import { offsetCalendarDate, toKstCalendarDate } from "@/lib/admin/analyticsKst";

export const PARENT_ROLES = new Set(["owner_parent", "parent"]);

// 2026-08-18 실측: `play_start` 는 프로덕션에 **한 건도 없다**. 놀이는 완료 시점에만
// `play_complete` 를 남긴다(13건). 지시서 정의(play_start)를 그대로 쓰면 놀이 사용
// 아이가 영원히 0명으로 나온다. 둘 다 인정한다 — 나중에 play_start 가 생겨도 그대로 동작한다.
export const PLAY_EVENTS = new Set(["play_start", "play_complete"]);
export const CHILD_CORE_EVENTS = new Set(["mission_start", "freechat_start", ...PLAY_EVENTS]);

// 부모 리포트 열람 이벤트. report_views.viewer_id 는 2026-08-18 에 추가돼 그 이전
// 열람이 없다(1건). 과거 열람은 behavior_events 에만 102건 남아 있으므로 둘을 합집합으로 센다.
export const PARENT_REPORT_VIEW_EVENTS = new Set([
  "parent_report_view",
  "daily_report_view",
]);
export const PARENT_CORE_EVENTS = new Set(["parent_report_view", "parent_conversation_topic_view"]);

export interface MetricWithRate {
  count: number;
  total: number;
  rate: number;
}

export interface DistributionBucket {
  bucket: "0" | "1" | "2-4" | "5-7";
  label: "미사용" | "단발" | "반복사용" | "고활성";
  count: number;
  rate: number;
}

export interface ChildUserRow {
  id: string;
  name: string;
  familyId: string;
  joinedAt: string;
  lastUsedAt: string | null;
  last7ActiveDays: number;
  last30ActiveDays: number;
  missionCount: number;
  freechatCount: number;
  playCount: number;
  reportCount: number;
}

export interface ParentUserRow {
  id: string;
  name: string;
  familyId: string;
  joinedAt: string;
  lastUsedAt: string | null;
  last7ActiveDays: number;
  last30ActiveDays: number;
  reportViewCount: number;
}

export interface UserAnalyticsSignup {
  totalFamilies: number;
  totalParents: number;
  totalChildren: number;
  activeChildren: MetricWithRate;
}

export interface UserAnalyticsUsage {
  mission: MetricWithRate;
  freechat: MetricWithRate;
  play: MetricWithRate;
  missionCompletionRate: MetricWithRate;
  reportGenerated: MetricWithRate;
  parentViewed: MetricWithRate;
  reportViewTotal: number;
  reportViewAvgPerViewer: number | null;
}

export interface UserAnalyticsRepeat {
  last7Distribution: DistributionBucket[];
  last30AvgActiveDays: number;
  familyRepeatRate: MetricWithRate;
}

export interface UserAnalyticsUsers {
  children: ChildUserRow[];
  parents: ParentUserRow[];
}

export interface UserAnalyticsResponse {
  signup: UserAnalyticsSignup;
  usage: UserAnalyticsUsage;
  repeat: UserAnalyticsRepeat;
  users: UserAnalyticsUsers;
}

export function roundRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function roundAvg(sum: number, count: number, decimals = 2): number {
  if (count <= 0) return 0;
  const factor = 10 ** decimals;
  return Math.round((sum / count) * factor) / factor;
}

export function dedupeActiveDates(
  events: Array<{ occurred_at: string }>,
  fromDateStr?: string,
  toDateStr?: string,
): Set<string> {
  const dates = new Set<string>();
  for (const e of events) {
    if (!e.occurred_at) continue;
    const dateStr = toKSTDateStr(e.occurred_at);
    if (fromDateStr && dateStr < fromDateStr) continue;
    if (toDateStr && dateStr > toDateStr) continue;
    dates.add(dateStr);
  }
  return dates;
}

export function calculateFamilyRepeatRate(
  familyIds: string[],
  eventsByFamily: Map<string, Array<{ occurred_at: string }>>,
): MetricWithRate {
  const total = familyIds.length;
  let repeatingFamiliesCount = 0;

  for (const fId of familyIds) {
    const events = eventsByFamily.get(fId) ?? [];
    const activeDates = dedupeActiveDates(events);
    if (activeDates.size >= 2) {
      repeatingFamiliesCount += 1;
    }
  }

  return {
    count: repeatingFamiliesCount,
    total,
    rate: roundRate(repeatingFamiliesCount, total),
  };
}

export function calculateLast7Distribution(
  childIds: string[],
  childEventsMap: Map<string, Array<{ occurred_at: string }>>,
  todayKst: string,
): DistributionBucket[] {
  const from7d = offsetCalendarDate(todayKst, -6);
  const to7d = todayKst;
  const totalChildren = childIds.length;

  let count0 = 0;
  let count1 = 0;
  let count2to4 = 0;
  let count5to7 = 0;

  for (const childId of childIds) {
    const events = childEventsMap.get(childId) ?? [];
    const activeDays = dedupeActiveDates(events, from7d, to7d).size;

    if (activeDays === 0) {
      count0 += 1;
    } else if (activeDays === 1) {
      count1 += 1;
    } else if (activeDays >= 2 && activeDays <= 4) {
      count2to4 += 1;
    } else if (activeDays >= 5) {
      count5to7 += 1;
    }
  }

  return [
    { bucket: "0", label: "미사용", count: count0, rate: roundRate(count0, totalChildren) },
    { bucket: "1", label: "단발", count: count1, rate: roundRate(count1, totalChildren) },
    { bucket: "2-4", label: "반복사용", count: count2to4, rate: roundRate(count2to4, totalChildren) },
    { bucket: "5-7", label: "고활성", count: count5to7, rate: roundRate(count5to7, totalChildren) },
  ];
}

export function calculateLast30AvgActiveDays(
  childIds: string[],
  childEventsMap: Map<string, Array<{ occurred_at: string }>>,
  todayKst: string,
): number {
  if (childIds.length === 0) return 0;
  const from30d = offsetCalendarDate(todayKst, -29);
  const to30d = todayKst;

  let totalActiveDays = 0;
  for (const childId of childIds) {
    const events = childEventsMap.get(childId) ?? [];
    const activeDays = dedupeActiveDates(events, from30d, to30d).size;
    totalActiveDays += activeDays;
  }

  return roundAvg(totalActiveDays, childIds.length, 2);
}

export interface RawAnalyticsInput {
  families: Array<{ id: string; name?: string | null; created_at: string }>;
  familyMembers: Array<{
    id: string;
    family_id: string;
    user_id: string;
    role: string;
    is_internal_test?: boolean | null;
    joined_at?: string | null;
    created_at?: string;
  }>;
  parents: Array<{ id: string; name?: string | null; email?: string | null; created_at?: string }>;
  children: Array<{
    id: string;
    family_id: string;
    member_id?: string | null;
    name?: string | null;
    given_name?: string | null;
    family_name?: string | null;
    is_internal_test?: boolean | null;
    is_test_account?: boolean | null;
    created_at: string;
  }>;
  dailyReports: Array<{ id: string; family_id?: string | null; child_id?: string | null; created_at?: string }>;
  reportViews: Array<{ id: string; report_id: string; viewer_id?: string | null; viewed_at: string }>;
  missionProgress: Array<{ session_id?: string; child_id?: string; status?: string | null; business_date?: string; updated_at?: string | null }>;
  behaviorEvents: Array<{
    id: string;
    event_name: string;
    actor_type: string;
    actor_id?: string | null;
    family_id?: string | null;
    child_id?: string | null;
    occurred_at: string;
  }>;
  testFamilyIds: Set<string>;
  includeTestAccounts: boolean;
  selectedFromDateStr: string;
  selectedToDateStr: string;
  now?: Date;
  scope?: "all" | "family" | "parent" | "child";
}

export function computeUserAnalytics(input: RawAnalyticsInput): UserAnalyticsResponse {
  const {
    families,
    familyMembers,
    parents,
    children,
    dailyReports,
    reportViews,
    missionProgress,
    behaviorEvents,
    testFamilyIds,
    includeTestAccounts,
    selectedFromDateStr,
    selectedToDateStr,
    now = new Date(),
    scope = "all",
  } = input;

  const todayKst = toKstCalendarDate(now);
  const from7d = offsetCalendarDate(todayKst, -6);
  const to7d = todayKst;
  const from30d = offsetCalendarDate(todayKst, -29);
  const to30d = todayKst;

  // 1. Filter valid families, parents, children
  const validFamilies = families.filter(
    (f) => includeTestAccounts || !testFamilyIds.has(f.id),
  );
  const validFamilyIds = new Set(validFamilies.map((f) => f.id));

  const validChildren = children.filter((c) => {
    if (!validFamilyIds.has(c.family_id)) return false;
    if (!includeTestAccounts && (c.is_internal_test || c.is_test_account)) return false;
    return true;
  });
  const validChildIds = new Set(validChildren.map((c) => c.id));
  const childFamilyMap = new Map(validChildren.map((c) => [c.id, c.family_id]));

  const parentById = new Map(parents.map((p) => [p.id, p]));
  const validParentMembers = familyMembers.filter((m) => {
    if (!validFamilyIds.has(m.family_id)) return false;
    if (!PARENT_ROLES.has(m.role)) return false;
    if (!m.user_id) return false;
    if (!includeTestAccounts && m.is_internal_test) return false;
    return true;
  });
  const validParentUserIds = new Set(validParentMembers.map((m) => m.user_id));
  const parentFamilyMap = new Map(validParentMembers.map((m) => [m.user_id, m.family_id]));

  // 2. Map core activity events
  const childEventsMap = new Map<string, Array<{ occurred_at: string; event_name: string }>>();
  const parentEventsMap = new Map<string, Array<{ occurred_at: string; event_name: string }>>();
  const familyEventsMap = new Map<string, Array<{ occurred_at: string; event_name: string }>>();

  for (const e of behaviorEvents) {
    if (!e.occurred_at) continue;

    // Check if child core activity
    if (CHILD_CORE_EVENTS.has(e.event_name)) {
      const childId = e.child_id || (e.actor_type === "child" ? e.actor_id : null);
      if (childId && validChildIds.has(childId)) {
        const list = childEventsMap.get(childId) ?? [];
        list.push(e);
        childEventsMap.set(childId, list);

        const famId = e.family_id || childFamilyMap.get(childId);
        if (famId && validFamilyIds.has(famId)) {
          const famList = familyEventsMap.get(famId) ?? [];
          famList.push(e);
          familyEventsMap.set(famId, famList);
        }
      }
    }

    // Check if parent core activity
    if (PARENT_CORE_EVENTS.has(e.event_name)) {
      const parentId = e.actor_type === "parent" ? e.actor_id : null;
      if (parentId && validParentUserIds.has(parentId)) {
        const list = parentEventsMap.get(parentId) ?? [];
        list.push(e);
        parentEventsMap.set(parentId, list);

        const famId = e.family_id || parentFamilyMap.get(parentId);
        if (famId && validFamilyIds.has(famId)) {
          const famList = familyEventsMap.get(famId) ?? [];
          famList.push(e);
          familyEventsMap.set(famId, famList);
        }
      }
    }
  }

  // 3. Signup Metrics
  const totalFamilies = validFamilies.length;
  const totalParents = validParentMembers.length;
  const totalChildren = validChildren.length;

  let activeChildrenCount = 0;
  for (const c of validChildren) {
    const events = childEventsMap.get(c.id) ?? [];
    const activeDates = dedupeActiveDates(events, selectedFromDateStr, selectedToDateStr);
    if (activeDates.size > 0) {
      activeChildrenCount += 1;
    }
  }

  const signup: UserAnalyticsSignup = {
    totalFamilies,
    totalParents,
    totalChildren,
    activeChildren: {
      count: activeChildrenCount,
      total: totalChildren,
      rate: roundRate(activeChildrenCount, totalChildren),
    },
  };

  // 4. Usage Metrics
  let missionChildCount = 0;
  let freechatChildCount = 0;
  let playChildCount = 0;

  for (const c of validChildren) {
    const events = childEventsMap.get(c.id) ?? [];
    const hasMission = events.some((e) => e.event_name === "mission_start");
    const hasFreechat = events.some((e) => e.event_name === "freechat_start");
    const hasPlay = events.some((e) => PLAY_EVENTS.has(e.event_name));

    if (hasMission) missionChildCount += 1;
    if (hasFreechat) freechatChildCount += 1;
    if (hasPlay) playChildCount += 1;
  }

  // Mission completion rate
  const validProgress = missionProgress.filter(
    (p) => !p.child_id || validChildIds.has(p.child_id),
  );
  const totalMissions = validProgress.length;
  const completedMissions = validProgress.filter((p) => p.status === "COMPLETED").length;

  // Reports generated per family
  const familiesWithReports = new Set<string>();
  const reportCountByChild = new Map<string, number>();
  for (const r of dailyReports) {
    const fId = r.family_id || (r.child_id ? childFamilyMap.get(r.child_id) : null);
    if (fId && validFamilyIds.has(fId)) {
      familiesWithReports.add(fId);
    }
    if (r.child_id && validChildIds.has(r.child_id)) {
      reportCountByChild.set(r.child_id, (reportCountByChild.get(r.child_id) ?? 0) + 1);
    }
  }

  // Report views per parent.
  //
  // 2026-08-18: report_views.viewer_id 는 이 날 추가돼 그 이전 열람에는 누가 봤는지가
  // 없다(실측 1건). 반면 behavior_events 에는 과거 열람이 102건 남아 있다.
  // 한쪽만 보면 "열람 부모 1명" 이라는 틀린 숫자가 나온다 — 실제는 8명이다.
  // 두 소스를 **합집합**으로 센다. 같은 부모가 양쪽에 있어도 Set 이라 1명이다.
  const reportViewCountByParent = new Map<string, number>();
  const viewingParents = new Set<string>();
  let totalReportViewsCount = 0;

  for (const v of reportViews) {
    totalReportViewsCount += 1;
    if (v.viewer_id && validParentUserIds.has(v.viewer_id)) {
      viewingParents.add(v.viewer_id);
      reportViewCountByParent.set(v.viewer_id, (reportViewCountByParent.get(v.viewer_id) ?? 0) + 1);
    }
  }

  // behavior_events 쪽 열람(과거분 포함). report_views 에 이미 잡힌 부모는 Set 이 흡수한다.
  for (const e of behaviorEvents) {
    if (!PARENT_REPORT_VIEW_EVENTS.has(e.event_name)) continue;
    if (e.actor_type !== "parent" || !e.actor_id) continue;
    if (!validParentUserIds.has(e.actor_id)) continue;
    viewingParents.add(e.actor_id);
    reportViewCountByParent.set(e.actor_id, (reportViewCountByParent.get(e.actor_id) ?? 0) + 1);
    totalReportViewsCount += 1;
  }

  const parentViewedCount = viewingParents.size;
  const reportViewAvgPerViewer =
    parentViewedCount > 0 ? Math.round((totalReportViewsCount / parentViewedCount) * 10) / 10 : null;

  const usage: UserAnalyticsUsage = {
    mission: {
      count: missionChildCount,
      total: totalChildren,
      rate: roundRate(missionChildCount, totalChildren),
    },
    freechat: {
      count: freechatChildCount,
      total: totalChildren,
      rate: roundRate(freechatChildCount, totalChildren),
    },
    play: {
      count: playChildCount,
      total: totalChildren,
      rate: roundRate(playChildCount, totalChildren),
    },
    missionCompletionRate: {
      count: completedMissions,
      total: totalMissions,
      rate: roundRate(completedMissions, totalMissions),
    },
    reportGenerated: {
      count: familiesWithReports.size,
      total: totalFamilies,
      rate: roundRate(familiesWithReports.size, totalFamilies),
    },
    parentViewed: {
      count: parentViewedCount,
      total: totalParents,
      rate: roundRate(parentViewedCount, totalParents),
    },
    reportViewTotal: totalReportViewsCount,
    reportViewAvgPerViewer,
  };

  // 5. Repeat Metrics
  const validFamilyIdList = validFamilies.map((f) => f.id);
  const familyRepeatRate = calculateFamilyRepeatRate(validFamilyIdList, familyEventsMap);

  const validChildIdList = validChildren.map((c) => c.id);
  const last7Distribution = calculateLast7Distribution(validChildIdList, childEventsMap, todayKst);
  const last30AvgActiveDays = calculateLast30AvgActiveDays(validChildIdList, childEventsMap, todayKst);

  const repeat: UserAnalyticsRepeat = {
    last7Distribution,
    last30AvgActiveDays,
    familyRepeatRate,
  };

  // 6. Users Drilldown
  const childUserRows: ChildUserRow[] = validChildren.map((c) => {
    const name =
      c.name || [c.family_name, c.given_name].filter(Boolean).join("") || "이름 미등록";
    const events = childEventsMap.get(c.id) ?? [];

    let lastUsedAt: string | null = null;
    let missionCount = 0;
    let freechatCount = 0;
    let playCount = 0;

    for (const e of events) {
      if (!lastUsedAt || e.occurred_at > lastUsedAt) {
        lastUsedAt = e.occurred_at;
      }
      if (e.event_name === "mission_start") missionCount += 1;
      if (e.event_name === "freechat_start") freechatCount += 1;
      if (e.event_name === "play_start") playCount += 1;
    }

    const last7ActiveDays = dedupeActiveDates(events, from7d, to7d).size;
    const last30ActiveDays = dedupeActiveDates(events, from30d, to30d).size;
    const reportCount = reportCountByChild.get(c.id) ?? 0;

    return {
      id: c.id,
      name,
      familyId: c.family_id,
      joinedAt: c.created_at,
      lastUsedAt,
      last7ActiveDays,
      last30ActiveDays,
      missionCount,
      freechatCount,
      playCount,
      reportCount,
    };
  });

  const parentUserRows: ParentUserRow[] = validParentMembers.map((m) => {
    const parent = parentById.get(m.user_id);
    const name = parent?.name || "이름 미등록";
    const events = parentEventsMap.get(m.user_id) ?? [];

    let lastUsedAt: string | null = null;
    for (const e of events) {
      if (!lastUsedAt || e.occurred_at > lastUsedAt) {
        lastUsedAt = e.occurred_at;
      }
    }

    const last7ActiveDays = dedupeActiveDates(events, from7d, to7d).size;
    const last30ActiveDays = dedupeActiveDates(events, from30d, to30d).size;
    const reportViewCount = reportViewCountByParent.get(m.user_id) ?? 0;

    return {
      id: m.user_id,
      name,
      familyId: m.family_id,
      joinedAt: m.joined_at || m.created_at || parent?.created_at || new Date().toISOString(),
      lastUsedAt,
      last7ActiveDays,
      last30ActiveDays,
      reportViewCount,
    };
  });

  const users: UserAnalyticsUsers = {
    children: scope === "parent" ? [] : childUserRows,
    parents: scope === "child" ? [] : parentUserRows,
  };

  return {
    signup,
    usage,
    repeat,
    users,
  };
}
