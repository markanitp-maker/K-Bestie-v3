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
  childCohortDates: Map<string, string>;
  parentCohortDates: Map<string, string>;
  familyCohortDates: Map<string, string>;
  testFamilyIds: Set<string>;
}

interface ChildIdentityRow {
  id: string;
  family_id: string | null;
  created_at: string;
}

interface ParentIdentityRow {
  user_id: string | null;
  family_id: string | null;
  role: string;
  created_at: string;
}

interface FamilyIdentityRow { id: string; created_at: string }

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

interface AnalyticsRowsQuery<T> extends PromiseLike<PageResult<T>> {
  order(column: string, options?: { ascending?: boolean }): AnalyticsRowsQuery<T>;
  range(from: number, to: number): AnalyticsRowsQuery<T>;
}

export interface AnalyticsRowOrder {
  column: string;
  uniqueColumn: string;
  ascending?: boolean;
}

export async function fetchAllAnalyticsRows<T>(
  queryFactory: () => unknown,
  order: AnalyticsRowOrder,
  pageSize = 1000,
  maxRows?: number,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const query = queryFactory() as AnalyticsRowsQuery<T>;
    let orderedQuery = query.order(order.column, { ascending: order.ascending ?? true });
    if (order.uniqueColumn !== order.column) {
      orderedQuery = orderedQuery.order(order.uniqueColumn, { ascending: order.ascending ?? true });
    }
    const { data, error } = await orderedQuery.range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (maxRows !== undefined && rows.length > maxRows) {
      throw new Error(`분석 대상 행이 안전 상한(${maxRows}건)을 초과했습니다 — 조회 기간을 좁혀주세요.`);
    }
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
    fetchAllAnalyticsRows<FamilyIdentityRow>(() => service
      .from("families")
      .select("id,created_at")
      .is("deleted_at", null), { column: "created_at", uniqueColumn: "id" }),
    fetchAllAnalyticsRows<ChildIdentityRow>(() => service
      .from("child_profiles")
      .select("id,family_id,created_at"), { column: "created_at", uniqueColumn: "id" }),
    fetchAllAnalyticsRows<ParentIdentityRow>(() => service
      .from("family_members")
      .select("user_id,family_id,role,created_at")
      .in("role", ["owner_parent", "parent"])
      .is("deleted_at", null), { column: "created_at", uniqueColumn: "id" }),
  ]);
  const failures = settled.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    const reason = failures[0].status === "rejected" ? failures[0].reason : null;
    throw reason instanceof Error ? reason : new Error("분석 대상 계정을 조회하지 못했습니다.");
  }

  const testFamilyIds = settled[0].status === "fulfilled" ? settled[0].value : new Set<string>();
  const families = settled[1].status === "fulfilled" ? settled[1].value : [];
  const children = settled[2].status === "fulfilled" ? settled[2].value : [];
  const parents = settled[3].status === "fulfilled" ? settled[3].value : [];
  const activeFamilyIds = new Set(families.map((family) => family.id));
  let channelFamilyIds: Set<string> | null = null;
  if (channel) {
    const channelSettled = await Promise.allSettled([
      fetchAllAnalyticsRows<AcquisitionLinkRow>(() => service.from("acquisition_links")
        .select("link_id").eq("channel_name", channel).is("deleted_at", null),
      { column: "link_id", uniqueColumn: "link_id" }),
      fetchAllAnalyticsRows<ParentAttributionRow>(() => service.from("parent_attributions")
        .select("parent_user_id,first_touch_link_id,signup_link_id"),
      { column: "parent_user_id", uniqueColumn: "parent_user_id" }),
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
  const childCohortDates = new Map<string, string>();
  const parentCohortDates = new Map<string, string>();
  const familyCohortDates = new Map(families.map((family) => [family.id, kstDateOfTimestamp(family.created_at)]));
  for (const child of children) {
    if (child.family_id
      && activeFamilyIds.has(child.family_id)
      && matchesInternalTestMode(child.family_id, testFamilyIds, internalTest)
      && (!channelFamilyIds || channelFamilyIds.has(child.family_id))) {
      childFamily.set(child.id, child.family_id);
      childCohortDates.set(child.id, kstDateOfTimestamp(child.created_at));
    }
  }
  for (const parent of parents) {
    if (parent.user_id
      && parent.family_id
      && activeFamilyIds.has(parent.family_id)
      && matchesInternalTestMode(parent.family_id, testFamilyIds, internalTest)
      && (!channelFamilyIds || channelFamilyIds.has(parent.family_id))) {
      parentFamily.set(parent.user_id, parent.family_id);
      parentCohortDates.set(parent.user_id, kstDateOfTimestamp(parent.created_at));
    }
  }
  return {
    childIds: new Set(childFamily.keys()),
    parentIds: new Set(parentFamily.keys()),
    familyIds: new Set([...childFamily.values(), ...parentFamily.values()]),
    childFamily,
    parentFamily,
    childCohortDates,
    parentCohortDates,
    familyCohortDates,
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
  cohortDateByUnit: ReadonlyMap<string, string> = new Map(),
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
    const unitIds = cohortDateByUnit.size > 0 ? cohortDateByUnit.keys() : datesByUnit.keys();
    for (const unitId of unitIds) {
      const dates = datesByUnit.get(unitId) ?? new Set<string>();
      const sorted = [...dates].sort();
      const cohortDate = cohortDateByUnit.get(unitId) ?? sorted[0];
      if (!cohortDate) continue;
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

export function groupAnalyticsRowsByFamily<T>(
  rows: readonly T[],
  resolveFamilyId: (row: T) => string | null | undefined,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const familyId = resolveFamilyId(row);
    if (!familyId) continue;
    const familyRows = grouped.get(familyId) ?? [];
    familyRows.push(row);
    grouped.set(familyId, familyRows);
  }
  return grouped;
}

export function resolveAnalyticsResultLimit(params: URLSearchParams, defaultLimit = 500, maxLimit = 500): number {
  const requested = Number(params.get("limit"));
  if (!Number.isInteger(requested) || requested <= 0) return defaultLimit;
  return Math.min(requested, maxLimit);
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
