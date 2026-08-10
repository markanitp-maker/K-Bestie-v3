import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import {
  calendarDayDiff,
  kstDateOfTimestamp,
  offsetCalendarDate,
  type InternalTestMode,
} from "@/lib/admin/analyticsKst";

export type AnalyticsMetricStatus = "ready" | "accumulating" | "unavailable";

export interface AnalyticsMetric<T> {
  value: T | null;
  status: AnalyticsMetricStatus;
  measuredFrom?: string | null;
  reason?: string;
}

export interface RetentionMetric {
  numerator: number | null;
  denominator: number | null;
  rate: number | null;
  status: AnalyticsMetricStatus;
  window: string;
}

export interface AnalyticsIdentity {
  childIds: Set<string>;
  parentIds: Set<string>;
  familyIds: Set<string>;
  childFamily: Map<string, string>;
  parentFamily: Map<string, string>;
  testFamilyIds: Set<string>;
}

interface ChildIdentityRow {
  id: string;
  family_id: string | null;
}

interface ParentIdentityRow {
  user_id: string | null;
  family_id: string | null;
  role: string;
}

interface AcquisitionLinkRow { link_id: string }
interface ParentAttributionRow {
  parent_user_id: string;
  first_touch_link_id: string | null;
  signup_link_id: string | null;
}

export interface ActivityPoint {
  unitId: string;
  occurredAt: string;
}

export interface FeatureActivityPoint extends ActivityPoint {
  feature: string;
  durationSeconds?: number | null;
  completed?: boolean;
}

export interface FeatureUsageMetric {
  feature: string;
  label: string;
  uniqueUsers: number;
  usageCount: number;
  usageRate: number | null;
  completionRate: number | null;
  averageDurationSeconds: number | null;
  status: AnalyticsMetricStatus;
  reason?: string;
}

export function settledValue<T>(result: PromiseSettledResult<T>, label: string): T {
  if (result.status === "fulfilled") return result.value;
  const detail = result.reason instanceof Error ? result.reason.message : String(result.reason ?? "unknown");
  throw new Error(`${label} 조회 실패: ${detail}`);
}

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function fetchAllAnalyticsRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryPage(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

export async function loadAnalyticsIdentity(
  service: SupabaseClient,
  internalTest: InternalTestMode,
  channel: string | null = null,
): Promise<AnalyticsIdentity> {
  const settled = await Promise.allSettled([
    getTestFamilyIds(service),
    fetchAllAnalyticsRows<ChildIdentityRow>((from, to) => service
      .from("child_profiles")
      .select("id,family_id")
      .order("id")
      .range(from, to)),
    fetchAllAnalyticsRows<ParentIdentityRow>((from, to) => service
      .from("family_members")
      .select("user_id,family_id,role")
      .in("role", ["owner_parent", "parent"])
      .order("id")
      .range(from, to)),
  ]);
  const failures = settled.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    const reason = failures[0].status === "rejected" ? failures[0].reason : null;
    throw reason instanceof Error ? reason : new Error("분석 대상 계정을 조회하지 못했습니다.");
  }

  const testFamilyIds = settled[0].status === "fulfilled" ? settled[0].value : new Set<string>();
  const children = settled[1].status === "fulfilled" ? settled[1].value : [];
  const parents = settled[2].status === "fulfilled" ? settled[2].value : [];
  let channelFamilyIds: Set<string> | null = null;
  if (channel) {
    const channelSettled = await Promise.allSettled([
      fetchAllAnalyticsRows<AcquisitionLinkRow>((from, to) => service.from("acquisition_links")
        .select("link_id").eq("channel_name", channel).is("deleted_at", null)
        .order("link_id").range(from, to)),
      fetchAllAnalyticsRows<ParentAttributionRow>((from, to) => service.from("parent_attributions")
        .select("parent_user_id,first_touch_link_id,signup_link_id")
        .order("parent_user_id").range(from, to)),
    ]);
    const linkIds = new Set(settledValue(channelSettled[0], "유입 채널 링크").map((row) => row.link_id));
    const attributedParents = new Set(settledValue(channelSettled[1], "부모 유입 귀속")
      .filter((row) => (row.signup_link_id && linkIds.has(row.signup_link_id))
        || (row.first_touch_link_id && linkIds.has(row.first_touch_link_id)))
      .map((row) => row.parent_user_id));
    channelFamilyIds = new Set(parents
      .filter((parent) => parent.user_id && parent.family_id && attributedParents.has(parent.user_id))
      .map((parent) => parent.family_id as string));
  }
  const childFamily = new Map<string, string>();
  const parentFamily = new Map<string, string>();
  for (const child of children) {
    if (child.family_id
      && matchesInternalTestMode(child.family_id, testFamilyIds, internalTest)
      && (!channelFamilyIds || channelFamilyIds.has(child.family_id))) {
      childFamily.set(child.id, child.family_id);
    }
  }
  for (const parent of parents) {
    if (parent.user_id
      && parent.family_id
      && matchesInternalTestMode(parent.family_id, testFamilyIds, internalTest)
      && (!channelFamilyIds || channelFamilyIds.has(parent.family_id))) {
      parentFamily.set(parent.user_id, parent.family_id);
    }
  }
  return {
    childIds: new Set(childFamily.keys()),
    parentIds: new Set(parentFamily.keys()),
    familyIds: new Set([...childFamily.values(), ...parentFamily.values()]),
    childFamily,
    parentFamily,
    testFamilyIds,
  };
}

export function matchesInternalTestMode(
  familyId: string | null,
  testFamilyIds: Set<string>,
  mode: InternalTestMode,
): boolean {
  if (!familyId) return false;
  if (mode === "include") return true;
  const isTest = testFamilyIds.has(familyId);
  return mode === "only" ? isTest : !isTest;
}

export function roundRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export function roundAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

export function accumulatingMetric<T>(measuredFrom: string | null, reason: string): AnalyticsMetric<T> {
  return { value: null, status: "accumulating", measuredFrom, reason };
}

export function readyMetric<T>(value: T, measuredFrom?: string | null): AnalyticsMetric<T> {
  return { value, status: "ready", ...(measuredFrom === undefined ? {} : { measuredFrom }) };
}

export function unavailableMetric<T>(reason: string): AnalyticsMetric<T> {
  return { value: null, status: "unavailable", reason };
}

const RETENTION_WINDOWS = {
  d1: { from: 1, to: 1, label: "D1" },
  d3: { from: 3, to: 3, label: "D3" },
  d7: { from: 7, to: 7, label: "D7" },
  d14: { from: 14, to: 14, label: "D14" },
  w2: { from: 14, to: 20, label: "W2" },
  w4: { from: 28, to: 34, label: "W4" },
} as const;

export type RetentionWindowKey = keyof typeof RETENTION_WINDOWS;

export function buildActivityRetention(
  points: ActivityPoint[],
  asOfDate: string,
): Record<RetentionWindowKey, RetentionMetric> {
  const datesByUnit = new Map<string, Set<string>>();
  for (const point of points) {
    const date = kstDateOfTimestamp(point.occurredAt);
    const dates = datesByUnit.get(point.unitId) ?? new Set<string>();
    dates.add(date);
    datesByUnit.set(point.unitId, dates);
  }
  const result = {} as Record<RetentionWindowKey, RetentionMetric>;
  for (const [key, window] of Object.entries(RETENTION_WINDOWS) as Array<[RetentionWindowKey, typeof RETENTION_WINDOWS[RetentionWindowKey]]>) {
    let denominator = 0;
    let numerator = 0;
    for (const dates of datesByUnit.values()) {
      const sorted = [...dates].sort();
      const cohortDate = sorted[0];
      if (calendarDayDiff(cohortDate, asOfDate) < window.to) continue;
      denominator += 1;
      const from = offsetCalendarDate(cohortDate, window.from);
      const to = offsetCalendarDate(cohortDate, window.to);
      if (sorted.some((date) => date >= from && date <= to)) numerator += 1;
    }
    result[key] = denominator === 0
      ? { numerator: null, denominator: null, rate: null, status: "accumulating", window: window.label }
      : { numerator, denominator, rate: roundRate(numerator, denominator), status: "ready", window: window.label };
  }
  return result;
}

export function buildFeatureUsage(
  definitions: Array<{ key: string; label: string; denominator: number; status?: AnalyticsMetricStatus; reason?: string }>,
  points: FeatureActivityPoint[],
): FeatureUsageMetric[] {
  return definitions.map((definition) => {
    const featurePoints = points.filter((point) => point.feature === definition.key);
    const users = new Set(featurePoints.map((point) => point.unitId));
    const starts = featurePoints.filter((point) => point.completed !== true);
    const completes = featurePoints.filter((point) => point.completed === true);
    const durations = featurePoints
      .map((point) => point.durationSeconds)
      .filter((value): value is number => typeof value === "number" && value >= 0);
    return {
      feature: definition.key,
      label: definition.label,
      uniqueUsers: users.size,
      usageCount: starts.length || featurePoints.length,
      usageRate: roundRate(users.size, definition.denominator),
      completionRate: starts.length > 0 ? roundRate(completes.length, starts.length) : null,
      averageDurationSeconds: roundAverage(durations),
      status: definition.status ?? "ready",
      ...(definition.reason ? { reason: definition.reason } : {}),
    };
  });
}

export function stableAnalyticsRef(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length > 0 ? present.sort((left, right) => right.localeCompare(left))[0] : null;
}
