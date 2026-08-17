/**
 * K Play 생명주기 및 Stale 세션 기준 설정 (§3-15, §3-16).
 *
 * 이 시간 동안 updated_at 이 갱신되지 않으면 stale 로 본다.
 * 앱 강제 종료·네트워크 단절로 end() 가 안 불린 세션을 영구 Active 로 두지 않는다.
 * 확정값이 아니라 관측 시작값이다.
 */
export const PLAY_SESSION_STALE_MS = 30 * 60 * 1000; // 30분

/**
 * 놀이 세션이 stale(유효시간 초과) 상태인지 판정합니다 (§3-15).
 * - updatedAt이 없으면 startedAt을 사용합니다.
 * - 둘 다 없으면 stale로 보지 않습니다 (정보 부재로 인한 오차단 방지).
 *
 * @param updatedAt 세션의 마지막 갱신 일시 (ISO 문자열 등)
 * @param nowMs 현재 시각 밀리초 타임스탬프
 * @param startedAt 세션의 시작 일시 (updatedAt 부재 시 폴백)
 */
export function isPlaySessionStale(
  updatedAt: string | null | undefined,
  nowMs: number,
  startedAt?: string | null | undefined
): boolean {
  const timeStr = updatedAt ?? startedAt;
  if (!timeStr) {
    return false;
  }
  const sessionTime = new Date(timeStr).getTime();
  if (Number.isNaN(sessionTime)) {
    return false;
  }
  return nowMs - sessionTime > PLAY_SESSION_STALE_MS;
}
