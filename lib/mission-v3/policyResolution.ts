import type { SupabaseClient } from "@supabase/supabase-js";

import { getKstBusinessDate } from "@/lib/utils/kstBusinessDate";

export interface ResolvedMissionPolicy {
  version: "v2_dual" | "v3_single_daily";
  effectiveAt: string | null;
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
 * Keeps a child on the legacy policy for the rest of a KST business date when
 * any v2 round already exists. This prevents an effective-at change during the
 * day from producing a mixed v2 + daily_single day for that child.
 */
export async function resolveMissionPolicyVersionForChild(input: {
  db: SupabaseClient;
  childId: string;
  now?: Date;
}): Promise<ResolvedMissionPolicy> {
  const now = input.now ?? new Date();
  const resolved = resolveMissionPolicyVersion(now);
  if (resolved.version !== "v3_single_daily") return resolved;

  const { data, error } = await input.db
    .from("mission_progress")
    .select("session_id")
    .eq("child_id", input.childId)
    .eq("business_date", getKstBusinessDate(now))
    .eq("mission_policy_version", "v2_dual")
    .in("round_type", ["round1_day", "round2_night", "common"])
    .limit(1);

  if (error) {
    throw new Error(`당일 v2 미션 조회 실패: ${error.message}`);
  }

  return (data?.length ?? 0) > 0
    ? { version: "v2_dual", effectiveAt: resolved.effectiveAt }
    : resolved;
}
