import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTENDANCE_ROULETTE_LABELS,
  ATTENDANCE_ROULETTE_RESULTS,
  isAttendanceRouletteResult,
  kstDateKey,
} from "./attendanceRoulette";

test("KST 00:00을 경계로 출석 일자가 논리적으로 바뀐다", () => {
  assert.equal(kstDateKey(new Date("2026-08-07T14:59:59.999Z")), "2026-08-07");
  assert.equal(kstDateKey(new Date("2026-08-07T15:00:00.000Z")), "2026-08-08");
});

test("룰렛 결과 7종과 사용자 표시가 모두 정의되어 있다", () => {
  assert.deepEqual(ATTENDANCE_ROULETTE_RESULTS, ["LOSE", "RETRY", "KEY_1", "KEY_3", "KEY_5", "KEY_7", "KEY_9"]);
  for (const code of ATTENDANCE_ROULETTE_RESULTS) assert.ok(ATTENDANCE_ROULETTE_LABELS[code]);
});

test("서버와 관리자 API는 허용된 결과 코드만 받는다", () => {
  assert.equal(isAttendanceRouletteResult("KEY_9"), true);
  assert.equal(isAttendanceRouletteResult("KEY_11"), false);
  assert.equal(isAttendanceRouletteResult({ result: "KEY_9" }), false);
});
