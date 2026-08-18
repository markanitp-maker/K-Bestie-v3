import test from "node:test";
import assert from "node:assert/strict";

import { composeBirthDate, daysInMonth, parseManualBirthDate } from "./birthDateInput";

const TODAY = "2026-08-19";

test("달의 마지막 날을 윤년까지 정확히 센다", () => {
  assert.equal(daysInMonth(2016, 2), 29);
  assert.equal(daysInMonth(2015, 2), 28);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test("년·월·일을 합쳐 yyyy-MM-dd 로 만든다", () => {
  assert.equal(composeBirthDate(2016, 2, 15), "2016-02-15");
  assert.equal(composeBirthDate(2016, 12, 3), "2016-12-03");
});

test("없는 날짜는 그 달 마지막 날로 당긴다", () => {
  // 3월 31일을 고른 뒤 2월로 바꾸면 2월 29일(윤년)이 된다 — 선택이 사라지지 않는다.
  assert.equal(composeBirthDate(2016, 2, 31), "2016-02-29");
  assert.equal(composeBirthDate(2015, 2, 30), "2015-02-28");
  assert.equal(composeBirthDate(2026, 4, 31), "2026-04-30");
});

test("아직 다 고르지 않았으면 빈 값이다", () => {
  assert.equal(composeBirthDate(null, 2, 15), "");
  assert.equal(composeBirthDate(2016, null, 15), "");
  assert.equal(composeBirthDate(2016, 2, null), "");
});

test("직접 입력은 여러 표기를 같은 날짜로 읽는다", () => {
  for (const raw of ["2016-02-15", "2016-2-15", "2016.2.15", "2016 2 15", "20160215", " 2016-02-15 "]) {
    const result = parseManualBirthDate(raw, TODAY);
    assert.equal(result.ok, true, raw);
    if (result.ok) assert.equal(result.value, "2016-02-15", raw);
  }
});

test("형식이 어긋나면 형식 오류로 알려준다", () => {
  for (const raw of ["2016", "16-02-15", "2016-13-01", "2016-02-30", "abc", "2016/02"]) {
    const result = parseManualBirthDate(raw, TODAY);
    assert.equal(result.ok, false, raw);
    if (!result.ok) assert.equal(result.reason, "format", raw);
  }
});

test("빈 입력과 미래 날짜를 구분해서 알려준다", () => {
  const empty = parseManualBirthDate("   ", TODAY);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, "empty");

  const future = parseManualBirthDate("2026-08-20", TODAY);
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.reason, "future");

  // 오늘은 허용한다.
  const todayResult = parseManualBirthDate(TODAY, TODAY);
  assert.equal(todayResult.ok, true);
});

test("윤년 2월 29일을 직접 입력할 수 있다", () => {
  const result = parseManualBirthDate("2016-02-29", TODAY);
  assert.equal(result.ok, true);
  const invalid = parseManualBirthDate("2015-02-29", TODAY);
  assert.equal(invalid.ok, false);
});
