// mission_onboarding_reward_tier SQL 함수(supabase/migrations/20260804010000_*.sql)와
// 반드시 동일한 값을 유지해야 한다 — 이 파일은 TS 쪽에서 "다음 구간" 같은 파생값을
// 표시할 때만 쓰고, 실제 지급액 확정은 항상 DB(RPC) 계산 결과를 그대로 쓴다.
export function missionOnboardingRewardTier(count: number): number {
  if (count >= 60) return 10000;
  if (count >= 50) return 5000;
  if (count >= 30) return 3000;
  if (count >= 10) return 1000;
  return 0;
}
