import type { SupabaseClient } from "@supabase/supabase-js";

import { getKstBusinessDate } from "@/lib/utils/kstBusinessDate";

export interface ResolvedMissionPolicy {
  version: "v2_dual" | "v3_single_daily";
  effectiveAt: string | null;
  /**
   * 당일 v2와 v3 정책 행이 동시에 존재하는 비정상 혼합 정책 상태 여부 (fail-closed 차단)
   */
  isMixed?: boolean;
  blockedReason?: "mixed_policy" | null;
}

export interface MissionProgressPolicyRow {
  session_id: string;
  mission_policy_version?: string | null;
  round_type?: string | null;
  effective_at?: string | null;
}

export function isV2ProgressRow(row: MissionProgressPolicyRow): boolean {
  const version = row.mission_policy_version;
  const roundType = row.round_type;

  if (isV3ProgressRow(row)) return false;

  const isLegacyRound =
    roundType === undefined ||
    roundType === null ||
    ["round1_day", "round2_night", "common"].includes(roundType);
  const isLegacyVersion = version === "v2_dual" || !version;
  const hasNoEffectiveAt = row.effective_at === null || row.effective_at === undefined;

  return isLegacyVersion && isLegacyRound && hasNoEffectiveAt;
}

export function isV3ProgressRow(row: MissionProgressPolicyRow): boolean {
  return (
    row.mission_policy_version === "v3_single_daily" &&
    row.round_type === "daily_single" &&
    row.effective_at !== null &&
    row.effective_at !== undefined
  );
}

export function resolveMissionPolicyVersion(
  now: Date = new Date(),
): ResolvedMissionPolicy {
  const configuredEffectiveAt = process.env.MISSION_V3_EFFECTIVE_AT?.trim();

  if (!configuredEffectiveAt) {
    return { version: "v2_dual", effectiveAt: null };
  }

  const effectiveAt = new Date(configuredEffectiveAt);
  if (!Number.isFinite(effectiveAt.getTime())) {
    console.error(
      "[mission-v3] MISSION_V3_EFFECTIVE_AT 날짜 파싱에 실패했습니다. v2_dual 정책으로 폴백합니다.",
      { configuredEffectiveAt },
    );
    return { version: "v2_dual", effectiveAt: null };
  }

  const parsedEffectiveAt = effectiveAt.toISOString();
  return {
    version: now.getTime() >= effectiveAt.getTime() ? "v3_single_daily" : "v2_dual",
    effectiveAt: parsedEffectiveAt,
  };
}

/**
 * Resolves the sticky mission policy for a child on a specific KST business date:
 * 1. If any existing row exists on the date, stick to that row's policy (bidirectional sticky).
 *    - Existing v2 row -> v2_dual (preserves legacy progress even after cutover)
 *    - Existing v3 row -> v3_single_daily (preserves v3 session even after rollback)
 * 2. If both v2 and v3 rows exist on the same date, fail-closed by returning isMixed: true.
 * 3. Only if no row exists on that date, evaluate MISSION_V3_EFFECTIVE_AT env.
 */
export async function resolveMissionPolicyVersionForChild(input: {
  db: SupabaseClient;
  childId: string;
  now?: Date;
}): Promise<ResolvedMissionPolicy> {
  const now = input.now ?? new Date();
  const businessDate = getKstBusinessDate(now);
  const resolvedFromEnv = resolveMissionPolicyVersion(now);

  const { data, error } = await input.db
    .from("mission_progress")
    .select("session_id, mission_policy_version, round_type, effective_at")
    .eq("child_id", input.childId)
    .eq("business_date", businessDate);

  if (error) {
    throw new Error(`당일 v2 미션 조회 실패: ${error.message}`);
  }

  const { data: preCutoverSessions, error: sessionError } = resolvedFromEnv.effectiveAt
    ? await input.db
        .from("chat_sessions")
        .select("id")
        .eq("child_id", input.childId)
        .eq("session_type", "mission")
        .eq("business_date", businessDate)
        .lt("started_at", resolvedFromEnv.effectiveAt)
        .limit(1)
    : { data: [], error: null };

  if (sessionError) {
    throw new Error(`당일 pre-cutover 미션 세션 조회 실패: ${sessionError.message}`);
  }

  const hasPreCutoverV2Session = (preCutoverSessions ?? []).length > 0;

  const rows = (data ?? []) as MissionProgressPolicyRow[];
  const hasV2Progress = rows.some(isV2ProgressRow);
  const hasV3 = rows.some(isV3ProgressRow);
  const hasV2 = hasV2Progress || hasPreCutoverV2Session;

  // 혼합 정책: 동일 KST 날짜에 v2와 v3 행이 동시 존재하면 fail-closed 차단
  if (hasV2 && hasV3) {
    console.error(
      "[mission-v3] 동일 KST 날짜에 v2와 v3 미션 행이 동시 존재하여 차단(fail-closed)합니다.",
      { childId: input.childId, businessDate },
    );
    return {
      version: "v2_dual",
      effectiveAt: null,
      isMixed: true,
      blockedReason: "mixed_policy",
    };
  }

  // 당일 v2 행 보유 -> v2 유지 (env와 무관)
  if (hasV2) {
    return {
      version: "v2_dual",
      effectiveAt: resolvedFromEnv.effectiveAt,
    };
  }

  // 당일 v3 행 보유 -> v3 유지 (env rollback으로 unset이어도 v3 유지)
  if (hasV3) {
    const v3Row = rows.find(isV3ProgressRow);
    return {
      version: "v3_single_daily",
      effectiveAt: v3Row?.effective_at ?? resolvedFromEnv.effectiveAt,
    };
  }

  // 당일 행 없음 -> env 기준
  return resolvedFromEnv;
}
