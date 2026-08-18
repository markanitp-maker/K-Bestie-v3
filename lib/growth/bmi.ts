// BMI 계산 (요청서 012 §3-4, §3-7).
//
// 공식 성장상태 측정계산기는 BMI 를 소수 첫째자리로 표기하고, 그 표기값으로 백분위를 조회한다.
// 2026-08-18 실측:
//   여아 120개월, 165cm/40kg → 공식 BMI 14.7, 백분위 7.1
//   원값(14.6923…)으로 계산하면 7.0 이 되어 공식과 어긋난다. 반올림값으로 계산해야 7.1 이 된다.
//   여아 119개월, 140cm/40kg → 공식 BMI 20.4, 백분위 84.2 (원값 20.408… 계산 시 84.3)
// 따라서 "소수 첫째자리 반올림 후 백분위 조회"가 공식 규칙이다.

/** 키(cm)와 몸무게(kg)로 BMI 를 구한다. 공식 표기 규칙에 맞춰 소수 첫째자리로 반올림한다. */
export function computeBmi(heightCm: number, weightKg: number): number | null {
  if (!(heightCm > 0) || !(weightKg > 0)) return null;
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  if (!Number.isFinite(bmi)) return null;
  return Math.round(bmi * 10) / 10;
}
