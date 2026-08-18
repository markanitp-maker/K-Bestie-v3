// 공식 판정 라벨과 부모용 중립 안내 문구 (요청서 012 §3-7, §3-8).
//
// 판정 기준과 라벨은 질병관리청 공식 성장상태 측정계산기의 출력을 2026-08-18 실측해 확정했다.
// 임의 임계값을 만들지 않는다.
//
//   연령별 신장 : 백분위 3 미만 → "저신장", 3 이상 97 이하 → "정상범위", 97 초과 → 라벨 없음
//                 (실측: 2.9 저신장 / 3.1 정상범위 / 97.0 정상범위 / 97.2 라벨 없음)
//   연령별 체중 : 백분위 5 미만 → "저체중", 그 밖 → 라벨 없음
//                 (실측: 4.9 저체중 / 5.1 라벨 없음. 공식 출력은 "저체중\n(Underweight)")
//   연령별 BMI  : 5 미만 → "쇠약증", 5~85 미만 → "정상범위", 85~95 미만 → "과체중", 95 이상 → "비만"
//                 (실측: 4.0 쇠약증 / 84.5 정상범위 / 85.3 과체중 / 94.9 과체중 / 95.2 비만)
//
// 라벨이 없는 구간(키 97 초과, 체중 5 이상)에서 공식 계산기는 판정을 표시하지 않는다.
// 우리도 같은 구간에서 판정을 만들어 붙이지 않는다.

import type { GrowthIndicator } from "./standards/kdca-2017";

export type GrowthVerdict = "저신장" | "저체중" | "쇠약증" | "정상범위" | "과체중" | "비만";

/** 공식 기준 판정. 공식이 판정을 표시하지 않는 구간은 null. */
export function officialVerdict(
  indicator: GrowthIndicator,
  percentile: number
): GrowthVerdict | null {
  if (indicator === "heightForAge") {
    if (percentile < 3) return "저신장";
    if (percentile <= 97) return "정상범위";
    return null;
  }
  if (indicator === "weightForAge") {
    return percentile < 5 ? "저체중" : null;
  }
  // bmiForAge
  if (percentile < 5) return "쇠약증";
  if (percentile < 85) return "정상범위";
  if (percentile < 95) return "과체중";
  return "비만";
}

/**
 * 부모에게 보여줄 중립 문구. 가치판단·의료 처방 표현을 쓰지 않는다(§3-8).
 * 한 번의 측정값으로 단정하지 않도록, 흐름을 함께 보라는 안내를 항상 덧붙인다.
 */
export function neutralPositionMessage(percentile: number, medianLabel: string): string {
  return `같은 성별·연령 성장도표에서 약 ${formatPercentile(percentile)}백분위에 있어요. 또래 중앙값은 약 ${medianLabel}예요.`;
}

/** 성장 흐름을 함께 보라는 고정 안내. 기록 수와 무관하게 항상 노출한다. */
export const GROWTH_TREND_NOTICE = "한 번의 측정값보다 성장 흐름을 함께 확인하는 것이 중요해요.";

/** 기록이 1건뿐일 때 추세를 단정하지 않도록 쓰는 안내(§3-7). */
export const GROWTH_SINGLE_RECORD_NOTICE =
  "기록이 한 건이라 아직 성장 흐름은 알 수 없어요. 다음 측정값이 쌓이면 함께 보여드릴게요.";

/** 공식 기준에서 지표가 제공되지 않는 경우의 안내(§3-6). */
export const GROWTH_UNSUPPORTED_NOTICE =
  "이 연령은 2017 소아청소년 성장도표에서 해당 기준을 제공하지 않아요.";

/**
 * 공식 기준상 확인이 필요한 구간(키 3백분위 미만, BMI 5백분위 미만 또는 95백분위 이상)에서만
 * 전문가 상의 참고 문구를 제공한다. 그 밖의 구간에서는 상담을 권하지 않는다(§3-8).
 */
export function needsProfessionalNotice(
  indicator: GrowthIndicator,
  percentile: number
): boolean {
  const verdict = officialVerdict(indicator, percentile);
  return verdict === "저신장" || verdict === "저체중" || verdict === "쇠약증" || verdict === "비만";
}

export const GROWTH_PROFESSIONAL_NOTICE =
  "걱정되는 변화가 지속되면 소아청소년과 등 전문가와 상의해 주세요.";

/** 백분위 표기 — 공식 계산기와 같이 소수 첫째자리, 정수면 정수로 보여준다. */
export function formatPercentile(percentile: number): string {
  const rounded = Math.round(percentile * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
