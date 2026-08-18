// 성장정보 계산의 단일 진입점 (요청서 012 §3-11 "서버와 클라이언트에 서로 다른 구현을
// 중복 생성하지 않는다"). API 라우트와 부모 화면 모두 이 모듈만 쓴다.

import { calculateAgeInMonths, formatKoreanAge } from "./age";
import { computeBmi } from "./bmi";
import { evaluatePercentile, valueAtPercentile } from "./lms";
import { officialVerdict, type GrowthVerdict } from "./assessment";
import {
  GROWTH_STANDARD_LABEL,
  GROWTH_STANDARD_SOURCE,
  GROWTH_STANDARD_VERSION,
  getSupportedAgeMonthRange,
  type GrowthIndicator,
  type GrowthSex,
} from "./standards/kdca-2017";

export * from "./age";
export * from "./consent";
export * from "./assessment";
export * from "./bmi";
export * from "./lms";
export {
  GROWTH_STANDARD_LABEL,
  GROWTH_STANDARD_SOURCE,
  GROWTH_STANDARD_VERSION,
  getSupportedAgeMonthRange,
} from "./standards/kdca-2017";
export type { GrowthIndicator, GrowthSex } from "./standards/kdca-2017";

/** DB(growth_measurements) 한 행에 대응하는 입력. 키·몸무게 중 하나만 있어도 된다. */
export interface GrowthMeasurementInput {
  id: string;
  measuredAt: string;
  heightCm: number | null;
  weightKg: number | null;
}

/** 한 지표의 공식 기준 비교 결과. */
export interface IndicatorEvaluation {
  value: number;
  /** 공식 데이터가 제공되지 않는 월령이면 null. */
  percentile: number | null;
  /** 또래 중앙값(50백분위). 공식 미제공이면 null. */
  median: number | null;
  verdict: GrowthVerdict | null;
  /** 공식 기준이 이 월령·지표를 제공하는지. */
  supported: boolean;
}

export interface EvaluatedMeasurement {
  id: string;
  measuredAt: string;
  ageMonths: number;
  ageLabel: string;
  height: IndicatorEvaluation | null;
  weight: IndicatorEvaluation | null;
  /** 같은 측정 행에 키와 몸무게가 모두 있을 때만 계산한다(§3-4). */
  bmi: IndicatorEvaluation | null;
}

function evaluateIndicator(
  indicator: GrowthIndicator,
  sex: GrowthSex,
  ageMonths: number,
  value: number | null
): IndicatorEvaluation | null {
  if (value === null || !(value > 0)) return null;
  const result = evaluatePercentile(indicator, sex, ageMonths, value);
  if (!result) {
    return { value, percentile: null, median: null, verdict: null, supported: false };
  }
  return {
    value,
    percentile: result.percentile,
    median: result.median,
    verdict: officialVerdict(indicator, result.percentile),
    supported: true,
  };
}

/**
 * 측정 한 건을 공식 기준으로 평가한다.
 * 생년월일보다 이른 측정일이면 null(계산 불가)을 반환한다.
 */
export function evaluateMeasurement(
  birthDate: string,
  sex: GrowthSex,
  measurement: GrowthMeasurementInput
): EvaluatedMeasurement | null {
  const ageMonths = calculateAgeInMonths(birthDate, measurement.measuredAt);
  if (ageMonths === null) return null;

  const bmiValue =
    measurement.heightCm !== null && measurement.weightKg !== null
      ? computeBmi(measurement.heightCm, measurement.weightKg)
      : null;

  return {
    id: measurement.id,
    measuredAt: measurement.measuredAt,
    ageMonths,
    ageLabel: formatKoreanAge(ageMonths),
    height: evaluateIndicator("heightForAge", sex, ageMonths, measurement.heightCm),
    weight: evaluateIndicator("weightForAge", sex, ageMonths, measurement.weightKg),
    bmi: evaluateIndicator("bmiForAge", sex, ageMonths, bmiValue),
  };
}

export interface LatestIndicatorSnapshot {
  measurementId: string;
  measuredAt: string;
  ageMonths: number;
  ageLabel: string;
  evaluation: IndicatorEvaluation;
}

export interface GrowthSummary {
  standardVersion: string;
  standardLabel: string;
  standardSource: string;
  /** 측정일 내림차순(최신 우선) 평가 결과. */
  history: EvaluatedMeasurement[];
  /** 키의 최신 non-null 기록. 키와 몸무게가 다른 날짜여도 각각 최신값을 쓴다(§3-1). */
  latestHeight: LatestIndicatorSnapshot | null;
  latestWeight: LatestIndicatorSnapshot | null;
  /** 키·몸무게가 같은 측정 행에 함께 있는 가장 최근 기록의 BMI. */
  latestBmi: LatestIndicatorSnapshot | null;
}

/**
 * 부모 화면이 필요한 모든 파생값을 한 번에 만든다.
 * 원본은 growth_measurements 이며 여기서 계산된 값은 저장하지 않는다(§3-11).
 */
export function buildGrowthSummary(
  birthDate: string,
  sex: GrowthSex,
  measurements: GrowthMeasurementInput[]
): GrowthSummary {
  const evaluated = measurements
    .map((measurement) => evaluateMeasurement(birthDate, sex, measurement))
    .filter((item): item is EvaluatedMeasurement => item !== null)
    .sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : a.measuredAt > b.measuredAt ? -1 : 0));

  const pickLatest = (
    selector: (item: EvaluatedMeasurement) => IndicatorEvaluation | null
  ): LatestIndicatorSnapshot | null => {
    for (const item of evaluated) {
      const evaluation = selector(item);
      if (evaluation) {
        return {
          measurementId: item.id,
          measuredAt: item.measuredAt,
          ageMonths: item.ageMonths,
          ageLabel: item.ageLabel,
          evaluation,
        };
      }
    }
    return null;
  };

  return {
    standardVersion: GROWTH_STANDARD_VERSION,
    standardLabel: GROWTH_STANDARD_LABEL,
    standardSource: GROWTH_STANDARD_SOURCE,
    history: evaluated,
    latestHeight: pickLatest((item) => item.height),
    latestWeight: pickLatest((item) => item.weight),
    latestBmi: pickLatest((item) => item.bmi),
  };
}

export interface PercentileCurvePoint {
  ageMonths: number;
  /** 백분위별 공식 기준값. 키는 백분위 문자열("3","50","97"). */
  values: Record<string, number>;
}

/**
 * 성장곡선에 겹쳐 그릴 공식 백분위 곡선을 만든다.
 * 공식 LMS 에서 직접 산출하므로 공식 백분위수 표와 같은 값이며, 임의 선을 생성하지 않는다(§3-7).
 */
export function buildPercentileCurve(
  indicator: GrowthIndicator,
  sex: GrowthSex,
  fromAgeMonths: number,
  toAgeMonths: number,
  percentiles: number[] = [3, 50, 97]
): PercentileCurvePoint[] {
  const range = getSupportedAgeMonthRange(indicator, sex);
  const start = Math.max(fromAgeMonths, range.min);
  const end = Math.min(toAgeMonths, range.max);
  const points: PercentileCurvePoint[] = [];

  for (let ageMonths = start; ageMonths <= end; ageMonths++) {
    const values: Record<string, number> = {};
    for (const percentile of percentiles) {
      const value = valueAtPercentile(indicator, sex, ageMonths, percentile);
      if (value !== null) values[String(percentile)] = Math.round(value * 10) / 10;
    }
    if (Object.keys(values).length > 0) points.push({ ageMonths, values });
  }

  return points;
}
