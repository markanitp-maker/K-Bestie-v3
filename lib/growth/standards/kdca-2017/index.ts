// 질병관리청 「2017 소아청소년 성장도표」 기준 데이터 접근 계층.
//
// 기준 교체(2027 성장도표 공표 등)를 대비해 이 파일만 갈아끼우면 되도록
// 계산 로직(lib/growth/lms.ts 등)은 이 모듈의 형태에만 의존한다.

import { KDCA_2017_LMS } from "./lms.generated";
import type { GrowthIndicator, GrowthSex, LmsTriple } from "./types";

export type { GrowthIndicator, GrowthSex, LmsTriple } from "./types";

/** DB(growth_measurements.standard_version)와 코드가 공유하는 단일 기준 식별자. */
export const GROWTH_STANDARD_VERSION = "KDCA_2017";

/** 화면에 그대로 노출하는 공식 기준 이름. */
export const GROWTH_STANDARD_LABEL = "2017 소아청소년 성장도표";

/** 기준 제공 기관 표기. */
export const GROWTH_STANDARD_SOURCE = "질병관리청·대한소아청소년과학회";

/**
 * 해당 지표·성별·월령의 LMS 를 반환한다. 공식 데이터가 제공하지 않는 월령이면 null.
 *
 * 공식 계산기도 지원 범위를 벗어난 월령(예: 228개월)에서는 결과를 내지 않는다(2026-08-18 실측).
 * 임의 보간·외삽으로 값을 만들지 않는다(요청서 012 §5).
 */
export function getLms(
  indicator: GrowthIndicator,
  sex: GrowthSex,
  ageMonths: number
): LmsTriple | null {
  if (!Number.isInteger(ageMonths) || ageMonths < 0) return null;
  return KDCA_2017_LMS[indicator][sex][ageMonths] ?? null;
}

/** 지표별 공식 지원 월령 범위. 데이터에서 직접 계산하므로 기준 교체 시 자동으로 따라간다. */
export function getSupportedAgeMonthRange(
  indicator: GrowthIndicator,
  sex: GrowthSex
): { min: number; max: number } {
  const months = Object.keys(KDCA_2017_LMS[indicator][sex]).map(Number);
  return { min: Math.min(...months), max: Math.max(...months) };
}

export function isAgeMonthsSupported(
  indicator: GrowthIndicator,
  sex: GrowthSex,
  ageMonths: number
): boolean {
  return getLms(indicator, sex, ageMonths) !== null;
}
