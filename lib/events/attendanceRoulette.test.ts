import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTENDANCE_ROULETTE_LABELS,
  ATTENDANCE_ROULETTE_RESULTS,
  ATTENDANCE_ROULETTE_SECTOR_ANGLE,
  attendanceRouletteRestingRotation,
  attendanceRouletteSectorCenterAngle,
  attendanceRouletteTargetRotation,
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

test("7개 섹터는 12시부터 시계 방향으로 균등 배치된다", () => {
  assert.equal(ATTENDANCE_ROULETTE_SECTOR_ANGLE, 360 / 7);
  ATTENDANCE_ROULETTE_RESULTS.forEach((code, index) => {
    const center = attendanceRouletteSectorCenterAngle(index);
    assert.equal(center, -90 + index * (360 / 7), code);
    const stoppedCenter = center + attendanceRouletteRestingRotation(code);
    assert.ok(Math.abs((stoppedCenter + 90) % 360) < 1e-9, code);
  });
});

test("애니메이션은 최소 4바퀴 전진하고 서버 결과 중심에 멈춘다", () => {
  const starts = [0, 137, 1440 - (3 * 360 / 7)];
  for (const start of starts) {
    ATTENDANCE_ROULETTE_RESULTS.forEach((code, index) => {
      const target = attendanceRouletteTargetRotation(start, code);
      assert.ok(target >= start + 4 * 360, `${code} must advance four turns`);
      const stoppedCenter = attendanceRouletteSectorCenterAngle(index) + target;
      const normalized = ((stoppedCenter + 90) % 360 + 360) % 360;
      assert.ok(normalized < 1e-9 || Math.abs(normalized - 360) < 1e-9, code);
    });
  }
});
