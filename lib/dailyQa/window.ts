// 요청서 019 §3-18, §3-21 — 분석 window 와 중복 Run 방지 키.
//
// [왜 business_date 전체가 아닌가]
// 요청서가 명시적으로 "전날 business_date 전체가 아니라 실행 시점 기준 직전 24시간" 이라고
// 못 박았다. 02:00 KST 에 돌면 전날 02:00 ~ 오늘 02:00 이다. business_date 로 자르면
// 자정 전후 대화가 두 Run 에 걸치거나 빠진다.

/** KST 오프셋(분). 이 프로젝트의 business_date 계산과 같은 기준이다. */
const KST_OFFSET_MINUTES = 9 * 60;
const WINDOW_HOURS = 24;

export interface DailyQaWindow {
  windowStart: string;
  windowEnd: string;
  /** window_end 시점의 KST 날짜. 관리자 화면이 "며칠자 점검" 으로 묶는 기준이다. */
  businessDate: string;
  executionKey: string;
}

function toKstDateString(iso: string): string {
  const ms = new Date(iso).getTime() + KST_OFFSET_MINUTES * 60_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 실행 시각을 **시간 단위로 내림**해 window 를 만든다.
 *
 * 왜 내림하는가: 크론이 02:00:03 에 돌든 02:00:47 에 돌든 같은 Run 이어야 한다.
 * 초 단위를 그대로 쓰면 execution_key 가 매번 달라져서 중복 방지(§3-21)가 무력해진다.
 * 관리자가 "지금 다시 점검" 을 눌러도 같은 시간대면 같은 Run 으로 묶인다.
 */
export function resolveDailyQaWindow(nowIso: string): DailyQaWindow {
  const end = new Date(nowIso);
  if (Number.isNaN(end.getTime())) {
    throw new Error("resolveDailyQaWindow: invalid nowIso");
  }
  end.setUTCMinutes(0, 0, 0);
  const start = new Date(end.getTime() - WINDOW_HOURS * 60 * 60_000);

  const windowEnd = end.toISOString();
  const windowStart = start.toISOString();
  return {
    windowStart,
    windowEnd,
    businessDate: toKstDateString(windowEnd),
    // 같은 window 를 두 번 저장하지 않기 위한 키(§3-21).
    // 크론과 수동 실행이 겹쳐도 같은 시간대면 같은 키가 나온다.
    executionKey: `daily-qa:${windowEnd}`,
  };
}
