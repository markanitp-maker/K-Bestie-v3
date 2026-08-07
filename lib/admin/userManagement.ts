export type InternalTestFilter = "exclude" | "include" | "only";
export type AdminUserRow = Record<string, unknown>;

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
