// 요금제별 유효 보존기간 계산 + 초과분(파기/복구 대상) 판정 순수 함수.
// 나이 판정 기준(앵커)은 호출자가 전달한다 — 세션 스코프(chat_sessions/chat_messages/
// daily_reports)는 chat_sessions.started_at, weekly_summaries는 자기 week_start.
// 이 모듈 자체는 앵커의 출처에 불가지(anchor-agnostic)하며 Date만 다룬다.

export type Tier = 1 | 2 | 3;

export interface RetentionResult {
  /** 유효 보존기간(개월). */
  months: number;
}

const START_TIER_MONTHS = 6; // Care Start 고정
const INSIGHT_BASE_YEARS = 3;
const INSIGHT_MAX_EXTENSIONS = 9; // 확장팩으로 최대 추가 9년 (총 12년)

/** 
 * 보존기간 계산
 * - tier 1: 6개월 고정
 * - tier 2: 기본 3년 + 확장팩 구매년수 (최대 +9년)
 * - tier 3: 선택한 보존기간 (1/3/5년)
 */
export function getEffectiveRetention(
  tier: Tier, 
  extensionYearsPurchased: number = 0,
  premiumRetentionYears: number = 5
): RetentionResult {
  if (tier === 1) {
    return { months: START_TIER_MONTHS };
  }

  if (tier === 2) {
    const ext = Math.max(0, Math.min(Math.floor(extensionYearsPurchased), INSIGHT_MAX_EXTENSIONS));
    return { months: (INSIGHT_BASE_YEARS + ext) * 12 };
  }

  // tier === 3 (Care Premium): 1, 3, 5년 중 선택
  const py = [1, 3, 5].includes(premiumRetentionYears) ? premiumRetentionYears : 5;
  return { months: py * 12 };
}

/** date에 개월 수를 더한 새 Date(UTC 기준 캘린더 연산 — 30일 근사가 아닌 정확한 월 단위). */
function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export interface PurgeAnchor {
  /** 나이 판정 기준 시각 — 세션 스코프는 chat_sessions.started_at, weekly는 week_start. */
  anchorTs: Date;
}

/** anchor가 유효 보존기간을 초과했는지(=파기/파기유예 대상인지) 판정. */
export function isPurgeCandidate(anchor: PurgeAnchor, now: Date, retention: RetentionResult): boolean {
  if (retention.months == null) return false;
  const cutoff = addMonthsUtc(anchor.anchorTs, retention.months);
  return cutoff.getTime() < now.getTime();
}
