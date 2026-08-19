// 요청서 019 §3-11, §3-12 — 전일 대비 이슈 상태 판정.
//
// 왜 별 모듈로 두는가: 이 판정이 관리자 화면의 유일한 판단 근거다.
// "어제보다 나아졌나 / 재발했나" 를 대표님이 여기 값만 보고 결정하므로,
// 규칙이 배치 로직 사이에 흩어지면 화면과 실제가 어긋난다.

import type { DailyQaTrendStatus } from "./taxonomy";

export interface DailyQaTrendInput {
  /** 오늘 발생 건수. */
  eventCount: number;
  /** 어제 발생 건수. 어제 Run 자체가 없으면 null(모르는 것과 0건은 다르다). */
  prevEventCount: number | null;
  /** 어제 이전에 한 번이라도 발생한 이력이 있는지. */
  hadHistoryBeforeYesterday: boolean;
  /** 오늘 분석한 세션 수. 0 이면 비율 비교를 하지 않는다. */
  analyzedSessions: number;
  /** 어제 분석한 세션 수. */
  prevAnalyzedSessions: number | null;
}

/**
 * 유의미한 감소로 볼 최소 비율. 절대 건수만으로 악화/개선을 단정하지 않는다(§3-12) —
 * 분석한 세션 수가 다르면 같은 건수도 의미가 다르다. 그래서 세션당 발생률로 비교한다.
 */
const IMPROVED_RATE_DROP = 0.5;
/** 발생률을 비교할 수 있는 최소 분모. 세션이 너무 적으면 비율이 요동친다. */
const MIN_SESSIONS_FOR_RATE = 5;

function issueRate(eventCount: number, analyzedSessions: number | null): number | null {
  if (!analyzedSessions || analyzedSessions < MIN_SESSIONS_FOR_RATE) return null;
  return eventCount / analyzedSessions;
}

export function resolveTrendStatus(input: DailyQaTrendInput): DailyQaTrendStatus {
  const { eventCount, prevEventCount, hadHistoryBeforeYesterday } = input;

  // 오늘 0건.
  if (eventCount === 0) {
    // 어제 났던 것이 오늘 0건이면 "해결 후보" 다. FIXED 가 아니다 —
    // 하루 0건으로 해결을 확정하지 않는다(§3-11). 연속 미발생 추적은 호출자가
    // 날짜별 Run 을 훑어서 판단한다.
    if (prevEventCount !== null && prevEventCount > 0) return "RESOLVED_CANDIDATE";
    return "RESOLVED_CANDIDATE";
  }

  // 과거 이력이 전혀 없으면 오늘 처음 난 것이다.
  if (!hadHistoryBeforeYesterday && (prevEventCount === null || prevEventCount === 0)) {
    return "NEW";
  }

  // 어제도 났고 오늘도 났다 — 개선됐는지 따진다.
  if (prevEventCount !== null && prevEventCount > 0) {
    const todayRate = issueRate(eventCount, input.analyzedSessions);
    const prevRate = issueRate(prevEventCount, input.prevAnalyzedSessions);
    if (todayRate !== null && prevRate !== null && prevRate > 0) {
      if (todayRate <= prevRate * IMPROVED_RATE_DROP) return "IMPROVED";
      return "ONGOING";
    }
    // 비율을 못 쓰면(분모가 너무 작음) 건수로만 본다. 절반 이하일 때만 개선이라 부른다.
    if (eventCount <= prevEventCount * IMPROVED_RATE_DROP) return "IMPROVED";
    return "ONGOING";
  }

  // 어제는 0건인데 과거에는 났었다 → 재발.
  return "RECURRED";
}
