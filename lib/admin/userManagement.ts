export type InternalTestFilter = "exclude" | "include" | "only";
export type AdminUserRow = Record<string, unknown>;

export type AdminUsersTab = "families" | "parents" | "children";

export interface AdminUsersCounts {
  families: number;
  parents: number;
  children: number;
  pending: number;
}

export interface AdminUsersOverviewResponse {
  tab: AdminUsersTab;
  counts: AdminUsersCounts;
  /** 이전 배포본과의 롤링 배포 호환용 alias. */
  kpi: AdminUsersCounts;
  items: AdminUserRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  meta: Record<string, unknown>;
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function finiteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseAdminUsersOverviewResponse(value: unknown): AdminUsersOverviewResponse {
  if (!value || typeof value !== "object") throw new Error("사용자 관리 API 응답 형식이 올바르지 않습니다.");
  const candidate = value as Record<string, unknown>;
  const rawCounts = candidate.counts ?? candidate.kpi;
  if (!rawCounts || typeof rawCounts !== "object" || !Array.isArray(candidate.items)) {
    throw new Error("사용자 관리 API 응답 형식이 올바르지 않습니다.");
  }
  const countSource = rawCounts as Record<string, unknown>;
  const counts = {
    families: finiteCount(countSource.families),
    parents: finiteCount(countSource.parents),
    children: finiteCount(countSource.children),
    pending: finiteCount(countSource.pending),
  };
  if (Object.values(counts).some((count) => count === null)) {
    throw new Error("사용자 관리 API 집계 형식이 올바르지 않습니다.");
  }

  const pagination = candidate.pagination as Record<string, unknown> | undefined;
  if (!pagination) throw new Error("사용자 관리 API 페이지 정보가 없습니다.");
  const normalizedPagination = {
    page: finiteCount(pagination.page),
    pageSize: finiteCount(pagination.pageSize),
    total: finiteCount(pagination.total),
    totalPages: finiteCount(pagination.totalPages),
  };
  if (Object.values(normalizedPagination).some((count) => count === null)) {
    throw new Error("사용자 관리 API 페이지 정보가 올바르지 않습니다.");
  }

  const tab: AdminUsersTab = candidate.tab === "parents" || candidate.tab === "children" ? candidate.tab : "families";
  return {
    tab,
    counts: counts as AdminUsersCounts,
    kpi: counts as AdminUsersCounts,
    items: candidate.items as AdminUserRow[],
    pagination: normalizedPagination as AdminUsersOverviewResponse["pagination"],
    meta: candidate.meta && typeof candidate.meta === "object" ? candidate.meta as Record<string, unknown> : {},
  };
}

export function toChildLoginId(emailOrUsername: string | null | undefined): string {
  const value = emailOrUsername?.trim() ?? "";
  return value.endsWith("@kbestie.local")
    ? value.slice(0, -"@kbestie.local".length)
    : value;
}

export function matchesInternalTestFilter(isTest: boolean, mode: InternalTestFilter): boolean {
  if (mode === "include") return true;
  return mode === "only" ? isTest : !isTest;
}

export function isCreatedInKstDateRange(
  createdAt: string | null | undefined,
  from: string,
  to: string,
): boolean {
  if (!from && !to) return true;
  if (!createdAt) return false;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(createdAt));
  const value = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
  return (!from || value >= from) && (!to || value <= to);
}

export function sortAdminUserRows<T extends AdminUserRow>(rows: T[], sort: string): T[] {
  const copy = [...rows];
  if (sort === "name_asc") {
    return copy.sort((a, b) => String(a.name ?? a.displayName ?? "").localeCompare(String(b.name ?? b.displayName ?? ""), "ko"));
  }
  if (sort === "created_asc") {
    return copy.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  }
  if (sort === "activity_desc") {
    return copy.sort((a, b) => String(b.lastActivityAt ?? b.lastSignInAt ?? "").localeCompare(String(a.lastActivityAt ?? a.lastSignInAt ?? "")));
  }
  if (sort === "status_asc") {
    return copy.sort((a, b) => String(a.status ?? a.approval ?? "").localeCompare(String(b.status ?? b.approval ?? ""), "ko"));
  }
  if (sort === "grade_asc") {
    return copy.sort((a, b) => String(a.grade ?? "").localeCompare(String(b.grade ?? ""), "ko"));
  }
  return copy.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}
