import { getOffsetDateStr } from "@/lib/analytics/kstDate";

export type RetentionPeriodParam = "today" | "7d" | "14d" | "30d" | "month" | "all" | "custom";

export interface RetentionPeriodRange {
  /** null이면 하한 없음(전체 기간) */
  fromStr: string | null;
  toStr: string;
}

// 관리자 리텐션 화면 전체(전체/부모/아이 탭, 상세 드릴다운, CSV)가 공유하는 단일
// 기간 해석 함수. 예전에는 overview/route.ts가 "month"/"all"을 아예 처리하지 않아
// 조용히 "7d"로 폴백됐고(else 분기), children/families/parents 드릴다운은 기간 파라미터
// 자체를 받지 않아 항상 전체 누적으로 집계됐다 — 화면의 기간 선택 버튼과 실제 표시되는
// 수치가 서로 다른 기준으로 계산되던 근본 원인 중 하나였다.
export function resolveRetentionPeriodRange(
  periodParam: string | null,
  todayStr: string,
  fromParam?: string | null,
  toParam?: string | null
): RetentionPeriodRange {
  if (periodParam === "custom" && fromParam && toParam) {
    return { fromStr: fromParam, toStr: toParam };
  }
  if (periodParam === "today") {
    return { fromStr: todayStr, toStr: todayStr };
  }
  if (periodParam === "14d") {
    return { fromStr: getOffsetDateStr(todayStr, -13), toStr: todayStr };
  }
  if (periodParam === "30d") {
    return { fromStr: getOffsetDateStr(todayStr, -29), toStr: todayStr };
  }
  if (periodParam === "month") {
    const monthStart = `${todayStr.slice(0, 7)}-01`;
    return { fromStr: monthStart, toStr: todayStr };
  }
  if (periodParam === "all") {
    return { fromStr: null, toStr: todayStr };
  }
  // 기본값 "7d" — periodParam이 없거나 인식되지 않는 값이면 안전하게 7일로 폴백한다.
  return { fromStr: getOffsetDateStr(todayStr, -6), toStr: todayStr };
}

/** business_date(YYYY-MM-DD 텍스트) 컬럼 비교용 — 문자열 사전식 비교가 곧 날짜 순서와 같다. */
export function isDateInRange(dateStr: string, range: RetentionPeriodRange): boolean {
  if (range.fromStr !== null && dateStr < range.fromStr) return false;
  if (dateStr > range.toStr) return false;
  return true;
}
