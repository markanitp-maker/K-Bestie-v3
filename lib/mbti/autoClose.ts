/**
 * S5(결과 화면) 완료 후 5분 무반응 자동 종료 판정 (SPEC.md §4, §2.1 step 9, US-010)
 *
 * 절대 시각 비교로 계산한다(`현재 - last_activity_at >= 5분`) — `setTimeout` 단독 방식은
 * 기기가 절전·백그라운드 상태였다가 돌아왔을 때 예정된 시각에 실행되지 않거나(지연) 아예
 * 실행되지 않을 수 있어(SPEC.md §4 "단순 setTimeout 금지", §9 "6분+ 잠금 후 복귀 즉시
 * 닫힘") 채택하지 않는다. 이 파일은 그 비교 로직만 순수 함수로 분리한 것이고, 실제 재계산
 * 트리거(`visibilitychange`/`pageshow`/`focus`/재실행/네트워크 재연결)는
 * `hooks/useResultAutoClose.ts`가 담당한다.
 */

/** SPEC.md §4: "완료 후 5분 자동 종료" */
export const AUTO_CLOSE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * `lastActivityAt` 이후 `now` 시점까지 `AUTO_CLOSE_TIMEOUT_MS` 이상 경과했으면 true.
 * 둘 다 `Date.now()`와 같은 절대 시각(ms epoch)이어야 한다 — 경과 시간을 재는 상대
 * 타이머(setTimeout)가 아니라 두 절대 시각의 차이를 비교하므로, 체크 시점이 늦어져도
 * (기기 잠금 후 복귀 등) 항상 올바르게 판정된다.
 */
export function isAutoCloseDue(lastActivityAt: number, now: number): boolean {
  return now - lastActivityAt >= AUTO_CLOSE_TIMEOUT_MS;
}
