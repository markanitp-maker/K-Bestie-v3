export type AttendanceRouletteChildSource = {
  id: string;
  family_id: string | null;
  is_internal_test: boolean | null;
};

export type AttendanceRouletteChildCohort<T extends AttendanceRouletteChildSource> = T & {
  isInternalTest: boolean;
};

export function selectAttendanceRouletteChildren<T extends AttendanceRouletteChildSource>(
  children: T[],
  testFamilyIds: Set<string>,
  includeTestAccounts: boolean,
): AttendanceRouletteChildCohort<T>[] {
  return children
    .map((child) => ({
      ...child,
      isInternalTest: Boolean(child.is_internal_test || (child.family_id && testFamilyIds.has(child.family_id))),
    }))
    .filter((child) => includeTestAccounts || !child.isInternalTest);
}

export function filterAttendanceRows<T extends { child_id: string }>(rows: T[], allowedChildIds: Set<string>): T[] {
  return rows.filter((row) => allowedChildIds.has(row.child_id));
}

export function attendanceResultCounts(rows: Array<{ result_code: string }>): Record<string, number> {
  const counts = Object.fromEntries(["LOSE", "RETRY", "KEY_1", "KEY_3", "KEY_5", "KEY_7", "KEY_9"].map((code) => [code, 0]));
  for (const row of rows) counts[row.result_code] = (counts[row.result_code] ?? 0) + 1;
  return counts;
}

export function attendanceParticipationSummary(
  targetChildren: number,
  days: Array<{ child_id: string; base_spin_used: boolean }>,
) {
  const participatedChildren = new Set(days.filter((day) => day.base_spin_used).map((day) => day.child_id)).size;
  return {
    targetChildren,
    participatedChildren,
    notParticipatedChildren: Math.max(0, targetChildren - participatedChildren),
  };
}
