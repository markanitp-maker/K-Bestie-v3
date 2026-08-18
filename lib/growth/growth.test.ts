import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGrowthSummary,
  buildPercentileCurve,
  calculateAgeInMonths,
  computeBmi,
  evaluateMeasurement,
  formatKoreanAge,
  isFutureDate,
  officialVerdict,
  parseDateOnly,
  standardNormalCdf,
  standardNormalQuantile,
  todayInKst,
  valueAtPercentile,
  type GrowthSex,
} from "./index";

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일의 기대값은 전부 질병관리청 공식 성장상태 측정계산기
// (https://knhanes.kdca.go.kr/knhanes/grtcht/clclt/measClclt.do, 내부 API
//  /knhanes/grtcht/findMeasClcltData.json)를 2026-08-18 직접 호출해 받은 실측값이다.
// 근거·재현 방법: docs/growth/kdca-2017-data-provenance.md
// ─────────────────────────────────────────────────────────────────────────────

/** 공식 계산기 diffMth 실측 대조 (요청서 012 §3-5, §7-2 월령 경계·윤년). */
const OFFICIAL_AGE_CASES: Array<{ birth: string; measured: string; months: number }> = [
  { birth: "2016-08-18", measured: "2026-08-18", months: 120 },
  { birth: "2016-08-18", measured: "2026-08-17", months: 119 },
  { birth: "2016-08-31", measured: "2026-09-01", months: 120 },
  { birth: "2016-09-01", measured: "2026-08-31", months: 119 },
  { birth: "2016-02-29", measured: "2026-02-28", months: 119 },
  { birth: "2016-02-29", measured: "2026-03-01", months: 120 },
  { birth: "2016-01-31", measured: "2026-02-28", months: 120 },
  { birth: "2016-12-31", measured: "2026-01-01", months: 108 },
  { birth: "2008-08-18", measured: "2026-08-18", months: 216 },
  { birth: "2026-08-18", measured: "2026-08-18", months: 0 },
];

test("월령 계산이 공식 계산기 diffMth 와 일치한다", () => {
  for (const { birth, measured, months } of OFFICIAL_AGE_CASES) {
    assert.equal(
      calculateAgeInMonths(birth, measured),
      months,
      `${birth} → ${measured} 는 ${months}개월이어야 한다`
    );
  }
});

test("측정일이 생년월일보다 이르면 월령을 계산하지 않는다", () => {
  assert.equal(calculateAgeInMonths("2026-08-18", "2026-08-17"), null);
  assert.equal(calculateAgeInMonths("2020-01-01", "2019-12-31"), null);
});

test("존재하지 않는 날짜와 잘못된 형식을 거른다", () => {
  assert.equal(parseDateOnly("2026-02-30"), null);
  assert.equal(parseDateOnly("2026-13-01"), null);
  assert.equal(parseDateOnly("20260818"), null);
  assert.deepEqual(parseDateOnly("2016-02-29"), { year: 2016, month: 2, day: 29 });
});

test("만 나이 표기", () => {
  assert.equal(formatKoreanAge(120), "만 10세");
  assert.equal(formatKoreanAge(119), "만 9세 11개월");
  assert.equal(formatKoreanAge(0), "만 0세");
  assert.equal(formatKoreanAge(13), "만 1세 1개월");
});

test("KST 기준 오늘과 미래 날짜 판정", () => {
  // 2026-08-18 15:30 UTC = 2026-08-19 00:30 KST
  assert.equal(todayInKst(new Date("2026-08-18T15:30:00Z")), "2026-08-19");
  // 2026-08-18 14:30 UTC = 2026-08-18 23:30 KST
  assert.equal(todayInKst(new Date("2026-08-18T14:30:00Z")), "2026-08-18");
  const now = new Date("2026-08-18T03:00:00Z");
  assert.equal(isFutureDate("2026-08-19", now), true);
  assert.equal(isFutureDate("2026-08-18", now), false);
  assert.equal(isFutureDate("2016-08-18", now), false);
});

interface OfficialCase {
  label: string;
  sex: GrowthSex;
  birth: string;
  measured: string;
  heightCm: number | null;
  weightKg: number | null;
  height?: { percentile: number; verdict: string | null };
  weight?: { percentile: number; verdict: string | null };
  bmi?: { value: number; percentile: number; verdict: string | null };
}

/**
 * 공식 계산기 실측 케이스.
 * 남/여, 저·중·고 백분위, 판정 경계(키 3/97, 체중 5, BMI 5/85/95), 월령 경계, BMI 미제공 구간을 덮는다.
 */
const OFFICIAL_CASES: OfficialCase[] = [
  {
    label: "여아 120개월 140/40 — 기준 케이스",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 140, weightKg: 40,
    height: { percentile: 55.7, verdict: "정상범위" },
    weight: { percentile: 78.6, verdict: null },
    bmi: { value: 20.4, percentile: 83.7, verdict: "정상범위" },
  },
  {
    label: "여아 119개월 140/40 — 월령이 하나 낮으면 백분위가 달라진다",
    sex: "female", birth: "2016-08-18", measured: "2026-08-17", heightCm: 140, weightKg: 40,
    height: { percentile: 59.3, verdict: "정상범위" },
    bmi: { value: 20.4, percentile: 84.2, verdict: "정상범위" },
  },
  {
    label: "남아 119개월 140/40 — 성별이 다르면 백분위가 달라진다",
    sex: "male", birth: "2016-08-18", measured: "2026-08-17", heightCm: 140, weightKg: 40,
    height: { percentile: 61.1, verdict: "정상범위" },
    bmi: { value: 20.4, percentile: 78.2, verdict: "정상범위" },
  },
  {
    label: "여아 120개월 118/18 — 최저 구간",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 118, weightKg: 18,
    height: { percentile: 0, verdict: "저신장" },
    weight: { percentile: 0, verdict: "저체중" },
    bmi: { value: 12.9, percentile: 0.6, verdict: "쇠약증" },
  },
  {
    label: "여아 120개월 130/24",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 130, weightKg: 24,
    height: { percentile: 6, verdict: "정상범위" },
    weight: { percentile: 1.9, verdict: "저체중" },
    bmi: { value: 14.2, percentile: 4, verdict: "쇠약증" },
  },
  {
    label: "키 판정 경계 — 2.9백분위는 저신장",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 128.1, weightKg: 30,
    height: { percentile: 2.9, verdict: "저신장" },
    bmi: { value: 18.3, percentile: 57.8, verdict: "정상범위" },
  },
  {
    label: "키 판정 경계 — 3.1백분위는 정상범위",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 128.3, weightKg: 30,
    height: { percentile: 3.1, verdict: "정상범위" },
    bmi: { value: 18.2, percentile: 56.2, verdict: "정상범위" },
  },
  {
    label: "키 상위 구간 — 97.8백분위는 공식이 판정을 표시하지 않는다",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 152, weightKg: 30,
    height: { percentile: 97.8, verdict: null },
  },
  {
    label: "키 상위 구간 — 99.3백분위",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 155, weightKg: 30,
    height: { percentile: 99.3, verdict: null },
  },
  {
    label: "체중 판정 경계 — 4.9백분위는 저체중",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 140, weightKg: 25.7,
    weight: { percentile: 4.9, verdict: "저체중" },
    bmi: { value: 13.1, percentile: 0.8, verdict: "쇠약증" },
  },
  {
    label: "체중 판정 경계 — 5.1백분위는 판정 없음",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 140, weightKg: 25.8,
    weight: { percentile: 5.1, verdict: null },
    bmi: { value: 13.2, percentile: 1, verdict: "쇠약증" },
  },
  {
    label: "BMI 판정 경계 — 84.5백분위는 정상범위",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 140, weightKg: 40.2,
    bmi: { value: 20.5, percentile: 84.5, verdict: "정상범위" },
  },
  {
    label: "BMI 판정 경계 — 85.3백분위는 과체중",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 140, weightKg: 40.4,
    bmi: { value: 20.6, percentile: 85.3, verdict: "과체중" },
  },
  {
    label: "BMI 판정 경계 — 94.9백분위는 과체중",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 140, weightKg: 43.9,
    bmi: { value: 22.4, percentile: 94.9, verdict: "과체중" },
  },
  {
    label: "BMI 판정 경계 — 95.2백분위는 비만",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 140, weightKg: 44.1,
    bmi: { value: 22.5, percentile: 95.2, verdict: "비만" },
  },
  {
    label: "여아 120개월 140/46 — 비만 구간",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 140, weightKg: 46,
    height: { percentile: 55.7, verdict: "정상범위" },
    weight: { percentile: 93.2, verdict: null },
    bmi: { value: 23.5, percentile: 97.5, verdict: "비만" },
  },
  {
    label: "여아 120개월 165/40 — 키 상위·BMI 하위",
    sex: "female", birth: "2016-08-18", measured: "2026-08-18", heightCm: 165, weightKg: 40,
    height: { percentile: 100, verdict: null },
    weight: { percentile: 78.6, verdict: null },
    bmi: { value: 14.7, percentile: 7.1, verdict: "정상범위" },
  },
  {
    label: "만 18세(216개월) 도 공식 범위 안이다",
    sex: "female", birth: "2008-08-18", measured: "2026-08-18", heightCm: 130, weightKg: 30,
    height: { percentile: 0, verdict: "저신장" },
  },
  {
    label: "24개월 미만은 공식이 BMI 를 제공하지 않는다",
    sex: "female", birth: "2025-08-18", measured: "2026-08-18", heightCm: 80, weightKg: 10,
    height: { percentile: 99, verdict: null },
  },
  {
    label: "24개월부터 공식 BMI 가 제공된다",
    sex: "female", birth: "2024-08-18", measured: "2026-08-18", heightCm: 88, weightKg: 12,
    height: { percentile: 76.1, verdict: "정상범위" },
    bmi: { value: 15.5, percentile: 44.3, verdict: "정상범위" },
  },
];

test("공식 계산기 실측값과 백분위·판정·BMI 가 일치한다", () => {
  for (const testCase of OFFICIAL_CASES) {
    const evaluated = evaluateMeasurement(testCase.birth, testCase.sex, {
      id: "fixture",
      measuredAt: testCase.measured,
      heightCm: testCase.heightCm,
      weightKg: testCase.weightKg,
    });
    assert.ok(evaluated, `${testCase.label}: 평가 결과가 있어야 한다`);

    if (testCase.height) {
      assert.equal(evaluated.height?.percentile, testCase.height.percentile, `${testCase.label}: 키 백분위`);
      assert.equal(evaluated.height?.verdict ?? null, testCase.height.verdict, `${testCase.label}: 키 판정`);
    }
    if (testCase.weight) {
      assert.equal(evaluated.weight?.percentile, testCase.weight.percentile, `${testCase.label}: 체중 백분위`);
      assert.equal(evaluated.weight?.verdict ?? null, testCase.weight.verdict, `${testCase.label}: 체중 판정`);
    }
    if (testCase.bmi) {
      assert.equal(evaluated.bmi?.value, testCase.bmi.value, `${testCase.label}: BMI 값`);
      assert.equal(evaluated.bmi?.percentile, testCase.bmi.percentile, `${testCase.label}: BMI 백분위`);
      assert.equal(evaluated.bmi?.verdict ?? null, testCase.bmi.verdict, `${testCase.label}: BMI 판정`);
    } else {
      // 기대값을 적지 않은 케이스는 공식이 BMI 를 제공하지 않는 구간이거나 몸무게가 없는 경우다.
      if (testCase.label.includes("24개월 미만")) {
        assert.equal(evaluated.bmi?.supported, false, `${testCase.label}: BMI 미제공이어야 한다`);
        assert.equal(evaluated.bmi?.percentile, null);
      }
    }
  }
});

test("공식 지원 범위를 벗어난 월령은 값을 만들지 않는다", () => {
  // 228개월(만 19세)은 공식 계산기도 결과를 내지 않는다(2026-08-18 실측).
  const evaluated = evaluateMeasurement("2007-08-18", "female", {
    id: "fixture",
    measuredAt: "2026-08-18",
    heightCm: 160,
    weightKg: 50,
  });
  assert.ok(evaluated);
  assert.equal(evaluated.ageMonths, 228);
  assert.equal(evaluated.height?.supported, false);
  assert.equal(evaluated.height?.percentile, null);
  assert.equal(evaluated.height?.median, null);
  assert.equal(evaluated.height?.verdict, null);
  assert.equal(evaluated.weight?.supported, false);
  assert.equal(evaluated.bmi?.supported, false);
});

test("BMI 는 같은 측정 행에 키와 몸무게가 모두 있을 때만 계산한다", () => {
  const base = { birth: "2016-08-18", measured: "2026-08-18" } as const;
  const heightOnly = evaluateMeasurement(base.birth, "female", {
    id: "h", measuredAt: base.measured, heightCm: 140, weightKg: null,
  });
  const weightOnly = evaluateMeasurement(base.birth, "female", {
    id: "w", measuredAt: base.measured, heightCm: null, weightKg: 40,
  });
  assert.equal(heightOnly?.bmi, null);
  assert.equal(heightOnly?.weight, null);
  assert.equal(weightOnly?.bmi, null);
  assert.equal(weightOnly?.height, null);
});

test("BMI 는 공식 표기 규칙대로 소수 첫째자리로 반올림한 값에서 백분위를 구한다", () => {
  // 165cm/40kg 원값은 14.6923… 이고, 공식 표기·조회값은 14.7 이다.
  assert.equal(computeBmi(165, 40), 14.7);
  assert.equal(computeBmi(140, 40), 20.4);
  assert.equal(computeBmi(139, 40), 20.7);
  assert.equal(computeBmi(0, 40), null);
  assert.equal(computeBmi(140, 0), null);
  assert.equal(computeBmi(-140, 40), null);
});

test("서로 다른 날짜의 키와 몸무게를 결합해 BMI 를 만들지 않는다", () => {
  const summary = buildGrowthSummary("2016-08-18", "female", [
    { id: "a", measuredAt: "2026-08-18", heightCm: 140, weightKg: null },
    { id: "b", measuredAt: "2026-08-17", heightCm: null, weightKg: 40 },
  ]);
  assert.equal(summary.latestHeight?.evaluation.value, 140);
  assert.equal(summary.latestWeight?.evaluation.value, 40);
  assert.equal(summary.latestBmi, null);
});

test("키와 몸무게의 최신값은 각각 가장 최근의 non-null 기록에서 온다", () => {
  const summary = buildGrowthSummary("2016-08-18", "female", [
    { id: "old", measuredAt: "2026-06-01", heightCm: 137, weightKg: 35 },
    { id: "mid", measuredAt: "2026-07-01", heightCm: null, weightKg: 38 },
    { id: "new", measuredAt: "2026-08-18", heightCm: 140, weightKg: null },
  ]);
  assert.equal(summary.latestHeight?.measuredAt, "2026-08-18");
  assert.equal(summary.latestHeight?.evaluation.value, 140);
  assert.equal(summary.latestWeight?.measuredAt, "2026-07-01");
  assert.equal(summary.latestWeight?.evaluation.value, 38);
  // BMI 는 키·몸무게가 함께 있는 가장 최근 행(2026-06-01)에서만 나온다.
  assert.equal(summary.latestBmi?.measuredAt, "2026-06-01");
  assert.equal(summary.latestBmi?.evaluation.value, computeBmi(137, 35));
  // 히스토리는 최신순이다.
  assert.deepEqual(summary.history.map((item) => item.id), ["new", "mid", "old"]);
});

test("또래 중앙값은 공식 M 값을 그대로 쓴다", () => {
  const evaluated = evaluateMeasurement("2016-08-18", "female", {
    id: "fixture", measuredAt: "2026-08-18", heightCm: 140, weightKg: null,
  });
  // 공식 데이터 테이블 여아 120개월 연령별 신장 L=-0.1573 / M=139.1218 / S=0.0438
  assert.equal(evaluated?.height?.median, 139.1218);
  // 50백분위 값은 M 과 같아야 한다.
  assert.equal(
    Math.round((valueAtPercentile("heightForAge", "female", 120, 50) as number) * 10) / 10,
    139.1
  );
});

/**
 * 공식 계산기와의 유일한 차이 원인과 그 크기를 못 박아 둔다(요청서 012 §7-2).
 *
 * 공식이 공개하는 성장도표 데이터 테이블은 L·M·S 를 소수 4자리로 반올림해 싣는다.
 * 공식 계산기는 반올림 전 내부값을 쓰는 것으로 보이며, 그 차이는 백분위 기준 약 0.0002%p 다.
 * 따라서 참값이 표시 반올림 경계(…95)에 걸리는 극히 좁은 구간에서만 표기가 0.1 어긋난다.
 *
 * 실측(2026-08-18, 여아 120개월):
 *   151.1cm → 우리 96.949806% (표기 96.9) / 공식 표기 97.0
 *   151.3cm → 우리 97.149761% (표기 97.1) / 공식 표기 97.2
 * 두 경우 모두 공식 판정(정상범위 / 판정 없음)은 동일하다. 허용오차를 임의로 넓히지 않고
 * 원인·크기·판정 영향 없음을 이 테스트로 고정한다.
 */
test("표시 반올림 경계에서의 차이는 0.1 이내이며 공식 판정을 바꾸지 않는다", () => {
  const boundaryCases: Array<{ heightCm: number; officialPercentile: number; officialVerdictLabel: string | null }> = [
    { heightCm: 151.1, officialPercentile: 97.0, officialVerdictLabel: "정상범위" },
    { heightCm: 151.3, officialPercentile: 97.2, officialVerdictLabel: null },
  ];

  for (const { heightCm, officialPercentile, officialVerdictLabel } of boundaryCases) {
    const evaluated = evaluateMeasurement("2016-08-18", "female", {
      id: "boundary", measuredAt: "2026-08-18", heightCm, weightKg: null,
    });
    const percentile = evaluated?.height?.percentile;
    assert.ok(percentile !== null && percentile !== undefined);
    assert.ok(
      Math.abs(percentile - officialPercentile) <= 0.1 + 1e-9,
      `${heightCm}cm: 공식 ${officialPercentile} 과의 차이가 0.1 을 넘었다 (우리 ${percentile})`
    );
    assert.equal(
      evaluated?.height?.verdict ?? null,
      officialVerdictLabel,
      `${heightCm}cm: 공식 판정과 달라졌다`
    );
  }
});

test("판정 라벨 경계값 자체를 직접 검증한다", () => {
  assert.equal(officialVerdict("heightForAge", 2.99), "저신장");
  assert.equal(officialVerdict("heightForAge", 3), "정상범위");
  assert.equal(officialVerdict("heightForAge", 97), "정상범위");
  assert.equal(officialVerdict("heightForAge", 97.01), null);
  assert.equal(officialVerdict("weightForAge", 4.99), "저체중");
  assert.equal(officialVerdict("weightForAge", 5), null);
  assert.equal(officialVerdict("bmiForAge", 4.99), "쇠약증");
  assert.equal(officialVerdict("bmiForAge", 5), "정상범위");
  assert.equal(officialVerdict("bmiForAge", 84.99), "정상범위");
  assert.equal(officialVerdict("bmiForAge", 85), "과체중");
  assert.equal(officialVerdict("bmiForAge", 94.99), "과체중");
  assert.equal(officialVerdict("bmiForAge", 95), "비만");
});

test("표준정규 분포 함수의 정확도", () => {
  assert.equal(Math.round(standardNormalCdf(0) * 1e12) / 1e12, 0.5);
  assert.ok(Math.abs(standardNormalCdf(1.959963984540054) - 0.975) < 1e-12);
  assert.ok(Math.abs(standardNormalCdf(-1.959963984540054) - 0.025) < 1e-12);
  for (const p of [0.001, 0.03, 0.5, 0.85, 0.97, 0.999]) {
    const z = standardNormalQuantile(p);
    assert.ok(Math.abs(standardNormalCdf(z) - p) < 1e-12, `p=${p} 왕복 오차`);
  }
});

test("성장곡선은 공식 지원 범위 안에서만 점을 만든다", () => {
  const curve = buildPercentileCurve("bmiForAge", "female", 0, 300);
  assert.equal(curve[0].ageMonths, 24);
  assert.equal(curve[curve.length - 1].ageMonths, 227);
  assert.deepEqual(Object.keys(curve[0].values).sort(), ["3", "50", "97"]);

  const heightCurve = buildPercentileCurve("heightForAge", "female", 118, 122, [50]);
  assert.deepEqual(heightCurve.map((point) => point.ageMonths), [118, 119, 120, 121, 122]);
  assert.equal(heightCurve[2].values["50"], 139.1);
});
