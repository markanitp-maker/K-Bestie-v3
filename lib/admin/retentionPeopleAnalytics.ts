import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInChunks } from "@/lib/analytics/kstDate";
import { computeChildActivityMetrics } from "@/lib/admin/retentionChildMetrics";
import { loadAnalyticsIdentity, settledValue } from "@/lib/admin/analyticsPhase2";
import { offsetCalendarDate, toKstCalendarDate, type AnalyticsKstFilters } from "@/lib/admin/analyticsKst";

export const INACTIVE_RISK_DAYS = 3;
export const LOW_USAGE_ACTIVE_DAYS = 1;
export const LOW_PARENT_REPORT_RATE = 50;
export const REPORT_VIEWER_TRACKING_START_DATE = "2026-08-18";

export interface ParentReportViewSummary {
  viewedCount: number;
  latestViewedAt: string | null;
}

export function aggregateParentReportViews(
  reportViews: Array<{ report_id: string; viewed_at: string; viewer_id?: string | null }>,
  parentId: string,
  familyReportIds?: Set<string>,
): ParentReportViewSummary {
  const viewedReportIds = new Set<string>();
  let latestViewedAt: string | null = null;

  for (const view of reportViews) {
    if (!view.viewer_id || view.viewer_id !== parentId) continue;
    if (familyReportIds && !familyReportIds.has(view.report_id)) continue;

    viewedReportIds.add(view.report_id);
    if (!latestViewedAt || Date.parse(view.viewed_at) > Date.parse(latestViewedAt)) {
      latestViewedAt = view.viewed_at;
    }
  }

  return {
    viewedCount: viewedReportIds.size,
    latestViewedAt,
  };
}

export type ChildUsageStatus = "initial" | "healthy" | "low_usage" | "churn_risk" | "parent_unread";
export type ParentUsageStatus = "active" | "low_engagement" | "report_unread";
export type RetentionResult = boolean | null;

export interface ChildAnalyticsRow {
  childId: string;
  childName: string;
  loginId: string | null;
  grade: string;
  familyId: string;
  familyName: string;
  parentNames: string[];
  firstMeaningfulUseAt: string | null;
  lastVisitAt: string | null;
  lastActivityAt: string | null;
  activeDaysLast7: number;
  activeDaysLast30: number;
  streakDays: number;
  d1: RetentionResult;
  d3: RetentionResult;
  d7: RetentionResult;
  w2: RetentionResult;
  missionCount: number;
  missionCompletedCount: number;
  missionCompletionRate: number | null;
  freechatCount: number;
  playCount: number;
  reportGeneratedCount: number;
  reportViewedCount: number;
  reportViewRate: number | null;
  parentQuestionCount: number;
  parentQuestionDeliveredCount: number;
  statuses: ChildUsageStatus[];
}

export interface ParentChildSummary {
  childId: string;
  childName: string;
  activeDaysLast7: number;
  d7: RetentionResult;
  statuses: ChildUsageStatus[];
}

export interface ParentAnalyticsRow {
  parentId: string;
  parentName: string;
  email: string | null;
  familyId: string;
  familyName: string;
  children: ParentChildSummary[];
  reportGeneratedCount: number;
  reportViewedCount: number;
  reportViewRate: number | null;
  latestReportViewedAt: string | null;
  parentQuestionCount: number;
  parentQuestionDeliveredCount: number;
  statuses: ParentUsageStatus[];
}

export interface PageResult<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export function daysBetweenKstDates(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function computeStreak(activeDates: readonly string[], today: string): number {
  const dates = new Set(activeDates);
  let cursor = today;
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  }
  return streak;
}

export function childStatuses(input: {
  today: string;
  firstMeaningfulUseAt: string | null;
  lastActivityAt: string | null;
  activeDaysLast7: number;
  reportGeneratedCount: number;
  reportViewedCount: number;
}): ChildUsageStatus[] {
  const statuses: ChildUsageStatus[] = [];
  const firstDate = input.firstMeaningfulUseAt?.slice(0, 10) ?? null;
  const lastDate = input.lastActivityAt?.slice(0, 10) ?? null;
  const isInitial = Boolean(firstDate && daysBetweenKstDates(firstDate, input.today) < 3);

  if (isInitial) statuses.push("initial");
  else if (!lastDate || daysBetweenKstDates(lastDate, input.today) >= INACTIVE_RISK_DAYS) statuses.push("churn_risk");
  else if (input.activeDaysLast7 <= LOW_USAGE_ACTIVE_DAYS) statuses.push("low_usage");
  else statuses.push("healthy");

  if (input.reportGeneratedCount > 0 && input.reportViewedCount === 0) statuses.push("parent_unread");
  return statuses;
}

export function parentStatuses(input: {
  reportGeneratedCount: number;
  reportViewedCount: number;
  reportViewRate: number | null;
}): ParentUsageStatus[] {
  if (input.reportGeneratedCount > 0 && input.reportViewedCount === 0) return ["report_unread"];
  if (input.reportGeneratedCount === 0 || (input.reportViewRate ?? 0) < LOW_PARENT_REPORT_RATE) return ["low_engagement"];
  return ["active"];
}

export function paginate<T>(rows: T[], requestedPage: number, requestedPageSize: number): PageResult<T> {
  const pageSize = [25, 50, 100, 500].includes(requestedPageSize) ? requestedPageSize : 25;
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const offset = (page - 1) * pageSize;
  return { rows: rows.slice(offset, offset + pageSize), page, pageSize, total, totalPages };
}

export function matchesSearch(values: Array<string | null | undefined>, search: string): boolean {
  const normalized = search.trim().toLocaleLowerCase("ko-KR");
  return normalized.length === 0 || values.some((value) => value?.toLocaleLowerCase("ko-KR").includes(normalized));
}

function timestamp(value: string | null): number {
  return value ? Date.parse(value) : 0;
}

export function sortChildren(rows: ChildAnalyticsRow[], sort: string): ChildAnalyticsRow[] {
  return [...rows].sort((left, right) => {
    if (sort === "last_newest") return timestamp(right.lastActivityAt) - timestamp(left.lastActivityAt);
    if (sort === "active7_low") return left.activeDaysLast7 - right.activeDaysLast7;
    if (sort === "d7_failure") return Number(left.d7 !== false) - Number(right.d7 !== false);
    if (sort === "mission_rate_low") return (left.missionCompletionRate ?? -1) - (right.missionCompletionRate ?? -1);
    if (sort === "report_rate_low") return (left.reportViewRate ?? -1) - (right.reportViewRate ?? -1);
    return timestamp(left.lastActivityAt) - timestamp(right.lastActivityAt);
  });
}

export function sortParents(rows: ParentAnalyticsRow[], sort: string): ParentAnalyticsRow[] {
  return [...rows].sort((left, right) => {
    if (sort === "report_rate_high") return (right.reportViewRate ?? -1) - (left.reportViewRate ?? -1);
    if (sort === "recent_view_newest") return timestamp(right.latestReportViewedAt) - timestamp(left.latestReportViewedAt);
    if (sort === "recent_view_oldest") return timestamp(left.latestReportViewedAt) - timestamp(right.latestReportViewedAt);
    return (left.reportViewRate ?? -1) - (right.reportViewRate ?? -1);
  });
}

interface ChildProfileRow { id: string; family_id: string; member_id: string | null; name: string; grade: string }
interface FamilyRow { id: string; name: string }
interface FamilyMemberRow { id: string; family_id: string; user_id: string | null; role: string }
interface ParentRow { id: string; name: string | null; email: string | null }
interface MemberAccountRow { id: string; username: string }
interface ReportRow { id: string; child_id: string; created_at: string }
interface ReportViewRow { report_id: string; viewed_at: string; viewer_id?: string | null }
interface ParentQuestionRow {
  id: string;
  child_id: string;
  parent_id: string | null;
  delivered_count: number | null;
  last_delivered_at: string | null;
  created_at: string;
}
interface LoginRow { child_id: string; occurred_at: string }

function latest(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function retentionValue(activeDates: Set<string>, firstDate: string | null, today: string, offset: number): RetentionResult {
  if (!firstDate || daysBetweenKstDates(firstDate, today) < offset) return null;
  return activeDates.has(offsetCalendarDate(firstDate, offset));
}

function w2Value(activeDates: Set<string>, firstDate: string | null, today: string): RetentionResult {
  if (!firstDate || daysBetweenKstDates(firstDate, today) < 14) return null;
  const start = offsetCalendarDate(firstDate, 8);
  const end = offsetCalendarDate(firstDate, 14);
  return [...activeDates].some((date) => date >= start && date <= end);
}

function isDelivered(question: ParentQuestionRow): boolean {
  return Number(question.delivered_count ?? 0) > 0 || Boolean(question.last_delivered_at);
}

export interface RetentionPeopleAnalyticsPayload {
  children: ChildAnalyticsRow[];
  parents: ParentAnalyticsRow[];
  reportViewIdentity: "individual" | "family";
  reportViewIdentityReason?: string | null;
}

export async function loadRetentionPeopleAnalytics(
  service: SupabaseClient,
  filters: AnalyticsKstFilters,
): Promise<RetentionPeopleAnalyticsPayload> {
  const identity = await loadAnalyticsIdentity(service, filters.internalTest, filters.channel);
  const childIds = [...identity.childIds];
  const parentIds = [...identity.parentIds];
  const familyIds = [...identity.familyIds];
  const currentKstDate = toKstCalendarDate(new Date());
  const today = filters.to > currentKstDate ? currentKstDate : filters.to;
  const last7From = offsetCalendarDate(today, -6);
  const last30From = offsetCalendarDate(today, -29);

  const settled = await Promise.allSettled([
    fetchInChunks<ChildProfileRow>(async (chunk, from, to) => await service.from("child_profiles")
      .select("id,family_id,member_id,name,grade").in("id", chunk).order("id").range(from, to), childIds),
    fetchInChunks<FamilyRow>(async (chunk, from, to) => await service.from("families")
      .select("id,name").in("id", chunk).order("id").range(from, to), familyIds),
    fetchInChunks<FamilyMemberRow>(async (chunk, from, to) => await service.from("family_members")
      .select("id,family_id,user_id,role").in("family_id", chunk).order("id").range(from, to), familyIds),
    fetchInChunks<ParentRow>(async (chunk, from, to) => await service.from("parents")
      .select("id,name,email").in("id", chunk).order("id").range(from, to), parentIds),
    fetchInChunks<ReportRow>(async (chunk, from, to) => await service.from("daily_reports")
      .select("id,child_id,created_at").in("child_id", chunk).gte("created_at", filters.fromIso)
      .lt("created_at", filters.toExclusiveIso).is("deleted_at", null).order("id").range(from, to), childIds),
    fetchInChunks<ParentQuestionRow>(async (chunk, from, to) => await service.from("parent_questions")
      .select("id,child_id,parent_id,delivered_count,last_delivered_at,created_at").in("child_id", chunk)
      .gte("created_at", filters.fromIso).lt("created_at", filters.toExclusiveIso).order("id").range(from, to), childIds),
    fetchInChunks<LoginRow>(async (chunk, from, to) => await service.from("behavior_events")
      .select("child_id,occurred_at").in("child_id", chunk).eq("event_name", "child_login")
      .order("occurred_at").range(from, to), childIds),
    computeChildActivityMetrics(service, childIds, { fromStr: last7From, toStr: today }),
    computeChildActivityMetrics(service, childIds, { fromStr: last30From, toStr: today }),
    computeChildActivityMetrics(service, childIds, { fromStr: null, toStr: today }),
    computeChildActivityMetrics(service, childIds, { fromStr: filters.from, toStr: filters.to }),
  ]);

  const childProfiles = settledValue(settled[0], "아이 프로필");
  const families = settledValue(settled[1], "가족");
  const familyMembers = settledValue(settled[2], "가족 구성원");
  const parentProfiles = settledValue(settled[3], "부모 프로필");
  const reports = settledValue(settled[4], "일간 리포트");
  const questions = settledValue(settled[5], "부모 질문");
  const logins = settledValue(settled[6], "아이 로그인");
  const metrics7 = settledValue(settled[7], "최근 7일 아이 활동");
  const metrics30 = settledValue(settled[8], "최근 30일 아이 활동");
  const metricsAll = settledValue(settled[9], "전체 아이 활동");
  const metricsPeriod = settledValue(settled[10], "선택 기간 아이 활동");

  const userIdByMemberId = new Map(familyMembers.filter((row) => row.role === "child" && row.user_id)
    .map((row) => [row.id, row.user_id as string]));
  const childAuthIds = [...new Set(childProfiles.map((row) => row.member_id ? userIdByMemberId.get(row.member_id) : null)
    .filter((value): value is string => Boolean(value)))];
  const accounts = childAuthIds.length === 0 ? [] : await fetchInChunks<MemberAccountRow>(async (chunk, from, to) => await service
    .from("member_accounts").select("id,username").in("id", chunk).order("id").range(from, to), childAuthIds);
  const usernameByUserId = new Map(accounts.map((row) => [row.id, row.username]));
  const familyNameById = new Map(families.map((row) => [row.id, row.name]));
  const parentProfileById = new Map(parentProfiles.map((row) => [row.id, row]));
  const parentIdsByFamily = new Map<string, string[]>();
  for (const member of familyMembers) {
    if (!member.user_id || !identity.parentIds.has(member.user_id)) continue;
    const ids = parentIdsByFamily.get(member.family_id) ?? [];
    ids.push(member.user_id);
    parentIdsByFamily.set(member.family_id, ids);
  }

  const reportById = new Map(reports.map((row) => [row.id, row]));
  const reportViews = reports.length === 0 ? [] : await fetchInChunks<ReportViewRow>(async (chunk, from, to) => await service
    .from("report_views").select("report_id,viewed_at,viewer_id").in("report_id", chunk).order("viewed_at").range(from, to), [...reportById.keys()]);
  const viewedReportIds = new Set(reportViews.map((row) => row.report_id));
  const reportsByChild = new Map<string, ReportRow[]>();
  for (const report of reports) {
    const rows = reportsByChild.get(report.child_id) ?? [];
    rows.push(report);
    reportsByChild.set(report.child_id, rows);
  }
  const questionsByChild = new Map<string, ParentQuestionRow[]>();
  const questionsByParent = new Map<string, ParentQuestionRow[]>();
  for (const question of questions) {
    const childRows = questionsByChild.get(question.child_id) ?? [];
    childRows.push(question);
    questionsByChild.set(question.child_id, childRows);
    if (question.parent_id) {
      const parentRows = questionsByParent.get(question.parent_id) ?? [];
      parentRows.push(question);
      questionsByParent.set(question.parent_id, parentRows);
    }
  }
  const lastVisitByChild = new Map<string, string>();
  for (const login of logins) lastVisitByChild.set(login.child_id, latest(lastVisitByChild.get(login.child_id) ?? null, login.occurred_at) as string);

  const children = childProfiles.map((profile): ChildAnalyticsRow => {
    const m7 = metrics7.get(profile.id);
    const m30 = metrics30.get(profile.id);
    const all = metricsAll.get(profile.id);
    const period = metricsPeriod.get(profile.id);
    const activeDates = all?.activeDates ?? [];
    const firstDate = activeDates[0] ?? null;
    const activeDateSet = new Set(activeDates);
    const childReports = reportsByChild.get(profile.id) ?? [];
    const viewed = childReports.filter((report) => viewedReportIds.has(report.id)).length;
    const childQuestions = questionsByChild.get(profile.id) ?? [];
    const generated = childReports.length;
    const completed = period?.completedMissionCount ?? 0;
    const attempted = period?.missionCount ?? 0;
    const lastActivityAt = all?.lastActivityAt ?? null;
    const statuses = childStatuses({
      today,
      firstMeaningfulUseAt: firstDate,
      lastActivityAt,
      activeDaysLast7: m7?.activeDaysTotal ?? 0,
      reportGeneratedCount: generated,
      reportViewedCount: viewed,
    });
    const authId = profile.member_id ? userIdByMemberId.get(profile.member_id) : null;
    return {
      childId: profile.id,
      childName: profile.name,
      loginId: authId ? usernameByUserId.get(authId) ?? null : null,
      grade: profile.grade,
      familyId: profile.family_id,
      familyName: familyNameById.get(profile.family_id) ?? "이름 없는 가족",
      parentNames: (parentIdsByFamily.get(profile.family_id) ?? []).map((parentId) => parentProfileById.get(parentId)?.name || "이름 없는 부모"),
      firstMeaningfulUseAt: firstDate,
      lastVisitAt: lastVisitByChild.get(profile.id) ?? null,
      lastActivityAt,
      activeDaysLast7: m7?.activeDaysTotal ?? 0,
      activeDaysLast30: m30?.activeDaysTotal ?? 0,
      streakDays: computeStreak(activeDates, today),
      d1: retentionValue(activeDateSet, firstDate, today, 1),
      d3: retentionValue(activeDateSet, firstDate, today, 3),
      d7: retentionValue(activeDateSet, firstDate, today, 7),
      w2: w2Value(activeDateSet, firstDate, today),
      missionCount: attempted,
      missionCompletedCount: completed,
      missionCompletionRate: percentage(completed, attempted),
      freechatCount: period?.freechatCount ?? 0,
      playCount: period?.playCount ?? 0,
      reportGeneratedCount: generated,
      reportViewedCount: viewed,
      reportViewRate: percentage(viewed, generated),
      parentQuestionCount: childQuestions.length,
      parentQuestionDeliveredCount: childQuestions.filter(isDelivered).length,
      statuses,
    };
  });

  const childrenByFamily = new Map<string, ChildAnalyticsRow[]>();
  for (const child of children) {
    const rows = childrenByFamily.get(child.familyId) ?? [];
    rows.push(child);
    childrenByFamily.set(child.familyId, rows);
  }
  const hasLegacyNullViews = reportViews.some((view) => !view.viewer_id);
  const parents = parentIds.map((parentId): ParentAnalyticsRow => {
    const familyId = identity.parentFamily.get(parentId) as string;
    const familyChildren = childrenByFamily.get(familyId) ?? [];
    const familyReports = familyChildren.flatMap((child) => reportsByChild.get(child.childId) ?? []);
    const familyReportIdSet = new Set(familyReports.map((report) => report.id));
    const { viewedCount, latestViewedAt } = aggregateParentReportViews(reportViews, parentId, familyReportIdSet);
    const parentQuestions = questionsByParent.get(parentId) ?? [];
    const generated = familyReports.length;
    const reportViewRate = percentage(viewedCount, generated);
    const profile = parentProfileById.get(parentId);
    return {
      parentId,
      parentName: profile?.name || "이름 없는 부모",
      email: profile?.email ?? null,
      familyId,
      familyName: familyNameById.get(familyId) ?? "이름 없는 가족",
      children: familyChildren.map((child) => ({
        childId: child.childId,
        childName: child.childName,
        activeDaysLast7: child.activeDaysLast7,
        d7: child.d7,
        statuses: child.statuses,
      })),
      reportGeneratedCount: generated,
      reportViewedCount: viewedCount,
      reportViewRate,
      latestReportViewedAt: latestViewedAt,
      parentQuestionCount: parentQuestions.length,
      parentQuestionDeliveredCount: parentQuestions.filter(isDelivered).length,
      statuses: parentStatuses({ reportGeneratedCount: generated, reportViewedCount: viewedCount, reportViewRate }),
    };
  });

  return {
    children,
    parents,
    reportViewIdentity: "individual",
    reportViewIdentityReason: hasLegacyNullViews
      ? `부모별 열람 추적은 ${REPORT_VIEWER_TRACKING_START_DATE}부터 제공됩니다. 그 이전 열람은 가족 단위 기록만 존재합니다.`
      : null,
  };
}
