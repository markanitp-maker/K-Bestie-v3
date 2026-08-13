// requests/032-mission-safety-unlock.md — MISSION_SAFETY_LOCK_ENABLED 환경변수가
// "true"일 때만 안전 화면 잠금(SAFETY_PAUSED) 활성화.
// 미설정(undefined) 또는 그 외 값일 경우 화면 잠금 해제(기본값: false / 잠금 해제).
export function isMissionSafetyLockEnabled(): boolean {
  return process.env.MISSION_SAFETY_LOCK_ENABLED === "true";
}
