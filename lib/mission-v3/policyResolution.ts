export function resolveMissionPolicyVersion(
  now: Date = new Date(),
): { version: "v2_dual" | "v3_single_daily"; effectiveAt: string | null } {
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
