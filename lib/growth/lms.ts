// LMS 방식 백분위 계산 (요청서 012 §3-6).
//
// 공식 「2017 소아청소년 성장도표」는 성별·월령별 L(왜도), M(중앙값), S(변동계수)를 제공하고
// 백분위수 표를 함께 싣는다. 개인 측정값의 백분위는 공식 계산기와 동일한 LMS 표준 산식으로 구한다.
//
//   L ≠ 0 : z = ((X/M)^L - 1) / (L·S)
//   L = 0 : z = ln(X/M) / S
//   백분위 = Φ(z) × 100
//
// 2026-08-18 공식 계산기 실측값과 대조해 소수 첫째자리까지 일치함을 확인했다(lib/growth/growth.test.ts).

import { getLms, type GrowthIndicator, type GrowthSex } from "./standards/kdca-2017";

/**
 * 표준정규 누적분포. Hart(1968)/West(2005) 배정밀도 근사로 오차가 1e-15 수준이라
 * 공식 계산기의 소수 첫째자리 표기와 어긋나지 않는다.
 */
export function standardNormalCdf(z: number): number {
  const absZ = Math.abs(z);
  let upperTail: number;

  if (absZ > 37) {
    upperTail = 0;
  } else {
    const density = Math.exp((-absZ * absZ) / 2);
    if (absZ < 7.07106781186547) {
      let numerator = 3.52624965998911e-2 * absZ + 0.700383064443688;
      numerator = numerator * absZ + 6.37396220353165;
      numerator = numerator * absZ + 33.912866078383;
      numerator = numerator * absZ + 112.079291497871;
      numerator = numerator * absZ + 221.213596169931;
      numerator = numerator * absZ + 220.206867912376;
      let denominator = 8.83883476483184e-2 * absZ + 1.75566716318264;
      denominator = denominator * absZ + 16.064177579207;
      denominator = denominator * absZ + 86.7807322029461;
      denominator = denominator * absZ + 296.564248779674;
      denominator = denominator * absZ + 637.333633378831;
      denominator = denominator * absZ + 793.826512519948;
      denominator = denominator * absZ + 440.413735824752;
      upperTail = (density * numerator) / denominator;
    } else {
      let continued = absZ + 0.65;
      continued = absZ + 4 / continued;
      continued = absZ + 3 / continued;
      continued = absZ + 2 / continued;
      continued = absZ + 1 / continued;
      upperTail = density / (continued * 2.506628274631);
    }
  }

  return z > 0 ? 1 - upperTail : upperTail;
}

/** 표준정규 분위수(역누적분포). Acklam 유리근사 + Halley 보정 1회로 1e-15 수준. */
export function standardNormalQuantile(probability: number): number {
  if (!(probability > 0 && probability < 1)) {
    throw new Error(`standardNormalQuantile: 0<p<1 이어야 한다 (받은 값 ${probability})`);
  }
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  let x: number;

  if (probability < pLow) {
    const q = Math.sqrt(-2 * Math.log(probability));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (probability <= 1 - pLow) {
    const q = probability - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  // Halley 보정 — 근사 오차(약 1e-9)를 배정밀도까지 좁힌다.
  const error = standardNormalCdf(x) - probability;
  const density = Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
  const u = error / density;
  return x - u / (1 + (x * u) / 2);
}

/** LMS 계수로 z 점수를 구한다. */
export function zScoreFromLms(value: number, [L, M, S]: [number, number, number]): number {
  if (!(value > 0) || !(M > 0) || !(S > 0)) {
    throw new Error("zScoreFromLms: 측정값·M·S 는 모두 양수여야 한다");
  }
  if (Math.abs(L) < 1e-12) {
    return Math.log(value / M) / S;
  }
  return (Math.pow(value / M, L) - 1) / (L * S);
}

/** z 점수를 백분위(0~100)로 바꾼다. 공식 계산기와 같이 소수 첫째자리로 표기한다. */
export function percentileFromZ(z: number): number {
  return standardNormalCdf(z) * 100;
}

export interface PercentileResult {
  /** 백분위(0~100). 공식 계산기와 동일하게 소수 첫째자리로 반올림한 값. */
  percentile: number;
  /** LMS z 점수. 반올림하지 않은 원값. */
  zScore: number;
  /** 같은 성별·월령의 중앙값(50백분위) = M. */
  median: number;
}

/**
 * 지표·성별·월령·측정값으로 공식 기준 위치를 구한다.
 * 공식 데이터가 해당 월령을 제공하지 않으면 null(= 제공되지 않음)을 반환한다.
 */
export function evaluatePercentile(
  indicator: GrowthIndicator,
  sex: GrowthSex,
  ageMonths: number,
  value: number
): PercentileResult | null {
  const lms = getLms(indicator, sex, ageMonths);
  if (!lms) return null;
  if (!(value > 0)) return null;

  const zScore = zScoreFromLms(value, lms);
  const rawPercentile = percentileFromZ(zScore);
  return {
    percentile: Math.round(rawPercentile * 10) / 10,
    zScore,
    median: lms[1],
  };
}

/**
 * 지표·성별·월령에서 특정 백분위에 해당하는 측정값을 구한다.
 * 성장곡선(공식 백분위 곡선) 렌더링에 쓰며, 공식 백분위수 표와 같은 값을 재현한다.
 */
export function valueAtPercentile(
  indicator: GrowthIndicator,
  sex: GrowthSex,
  ageMonths: number,
  percentile: number
): number | null {
  const lms = getLms(indicator, sex, ageMonths);
  if (!lms) return null;
  const [L, M, S] = lms;
  const z = standardNormalQuantile(percentile / 100);
  const value = Math.abs(L) < 1e-12 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
  return Number.isFinite(value) ? value : null;
}
