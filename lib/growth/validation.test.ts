import test from "node:test";
import assert from "node:assert/strict";

import {
  HEIGHT_CM_RANGE,
  WEIGHT_KG_RANGE,
  normalizeMeasurementValue,
  validateBirthDate,
  validateGender,
  validateMeasurementInput,
} from "./validation";
import {
  ELEMENTARY_AGE_MONTHS,
  isElementaryAgeMonths,
  needsBirthDateConfirmation,
} from "./consent";
import { todayInKst } from "./age";

const BIRTH_DATE = "2016-08-18";
const today = todayInKst();

test("생년월일 검증", () => {
  assert.equal(validateBirthDate(BIRTH_DATE), null);
  assert.equal(validateBirthDate("2016-02-29"), null);
  assert.equal(validateBirthDate("2016-02-30")?.field, "birthDate");
  assert.equal(validateBirthDate("")?.field, "birthDate");
  assert.equal(validateBirthDate(20160818 as unknown)?.field, "birthDate");
  // 미래 생년월일은 허용하지 않는다(§3-2).
  assert.equal(validateBirthDate("2099-01-01")?.field, "birthDate");
});

test("성별 검증은 기존 규격 male/female 만 허용한다", () => {
  assert.equal(validateGender("male"), null);
  assert.equal(validateGender("female"), null);
  assert.equal(validateGender("M")?.field, "gender");
  assert.equal(validateGender(null)?.field, "gender");
});

test("측정값은 소수 한 자리로 정규화한다", () => {
  assert.equal(normalizeMeasurementValue("140.55"), 140.6);
  assert.equal(normalizeMeasurementValue(40), 40);
  assert.equal(normalizeMeasurementValue(""), null);
  assert.equal(normalizeMeasurementValue(null), null);
  assert.ok(Number.isNaN(normalizeMeasurementValue("abc") as number));
});

test("키·몸무게 중 하나만 있어도 통과한다", () => {
  const heightOnly = validateMeasurementInput({ measuredAt: today, heightCm: "140" }, BIRTH_DATE);
  assert.ok(heightOnly.ok);
  assert.deepEqual(heightOnly.value, { measuredAt: today, heightCm: 140, weightKg: null });

  const weightOnly = validateMeasurementInput({ measuredAt: today, weightKg: "34.25" }, BIRTH_DATE);
  assert.ok(weightOnly.ok);
  assert.equal(weightOnly.value.weightKg, 34.3);
});

test("둘 다 비어 있으면 거부한다", () => {
  const result = validateMeasurementInput({ measuredAt: today }, BIRTH_DATE);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.field, "heightCm");
});

test("0·음수·문자·범위 밖 값을 거부한다", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ measuredAt: today, heightCm: "0" }, "heightCm"],
    [{ measuredAt: today, heightCm: "-140" }, "heightCm"],
    [{ measuredAt: today, heightCm: "abc" }, "heightCm"],
    [{ measuredAt: today, heightCm: String(HEIGHT_CM_RANGE.max + 1) }, "heightCm"],
    [{ measuredAt: today, weightKg: "0" }, "weightKg"],
    [{ measuredAt: today, weightKg: String(WEIGHT_KG_RANGE.max + 1) }, "weightKg"],
  ];
  for (const [payload, field] of cases) {
    const result = validateMeasurementInput(payload, BIRTH_DATE);
    assert.equal(result.ok, false, `${JSON.stringify(payload)} 는 거부돼야 한다`);
    if (!result.ok) assert.equal(result.failure.field, field);
  }
});

test("측정일은 미래일 수 없고 생년월일보다 이를 수 없다", () => {
  const future = validateMeasurementInput({ measuredAt: "2099-01-01", heightCm: "140" }, BIRTH_DATE);
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.failure.field, "measuredAt");

  const beforeBirth = validateMeasurementInput({ measuredAt: "2016-08-17", heightCm: "50" }, BIRTH_DATE);
  assert.equal(beforeBirth.ok, false);
  if (!beforeBirth.ok) assert.equal(beforeBirth.failure.field, "measuredAt");

  const badFormat = validateMeasurementInput({ measuredAt: "2026/08/18", heightCm: "140" }, BIRTH_DATE);
  assert.equal(badFormat.ok, false);
});

test("초등학생(만 6~13세) 범위 판정", () => {
  assert.equal(ELEMENTARY_AGE_MONTHS.min, 72);
  assert.equal(ELEMENTARY_AGE_MONTHS.max, 167);
  assert.equal(isElementaryAgeMonths(72), true);
  assert.equal(isElementaryAgeMonths(120), true);
  assert.equal(isElementaryAgeMonths(167), true);
  assert.equal(isElementaryAgeMonths(71), false);
  assert.equal(isElementaryAgeMonths(168), false);

  // 확인 안내는 여유 범위(만 5세~15세 11개월)를 벗어날 때만 띄운다.
  assert.equal(needsBirthDateConfirmation(120), false);
  assert.equal(needsBirthDateConfirmation(60), false);
  assert.equal(needsBirthDateConfirmation(59), true);
  assert.equal(needsBirthDateConfirmation(191), false);
  assert.equal(needsBirthDateConfirmation(192), true);
});
