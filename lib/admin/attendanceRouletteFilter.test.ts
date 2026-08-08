import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceParticipationSummary,
  attendanceResultCounts,
  filterAttendanceRows,
  selectAttendanceRouletteChildren,
} from "./attendanceRouletteFilter.js";

const children = [
  { id: "real", family_id: "family-real", is_internal_test: false },
  { id: "child-test", family_id: "family-child-test", is_internal_test: true },
  { id: "parent-test", family_id: "family-parent-test", is_internal_test: false },
];
const testFamilies = new Set(["family-child-test", "family-parent-test"]);

test("기본값은 아이 또는 부모가 내부 테스트인 가족 전체를 제외한다", () => {
  const selected = selectAttendanceRouletteChildren(children, testFamilies, false);
  assert.deepEqual(selected.map((child) => child.id), ["real"]);
  assert.equal(selected[0].isInternalTest, false);
});

test("포함 시 실제와 테스트 아이를 모두 반환하고 badge용 판정을 보존한다", () => {
  const selected = selectAttendanceRouletteChildren(children, testFamilies, true);
  assert.deepEqual(selected.map((child) => [child.id, child.isInternalTest]), [
    ["real", false],
    ["child-test", true],
    ["parent-test", true],
  ]);
});

test("KPI·breakdown·목록은 동일한 허용 child ID 모수를 사용한다", () => {
  const allowed = new Set(["real"]);
  const days = filterAttendanceRows([
    { child_id: "real", base_spin_used: true },
    { child_id: "child-test", base_spin_used: true },
  ], allowed);
  const spins = filterAttendanceRows([
    { child_id: "real", result_code: "KEY_1" },
    { child_id: "child-test", result_code: "KEY_9" },
  ], allowed);

  assert.deepEqual(attendanceParticipationSummary(1, days), {
    targetChildren: 1,
    participatedChildren: 1,
    notParticipatedChildren: 0,
  });
  assert.equal(attendanceResultCounts(spins).KEY_1, 1);
  assert.equal(attendanceResultCounts(spins).KEY_9, 0);
});

test("참여/미참여 합은 중복 day 행이 있어도 대상 아이 수와 같다", () => {
  const summary = attendanceParticipationSummary(2, [
    { child_id: "real", base_spin_used: true },
    { child_id: "real", base_spin_used: true },
  ]);
  assert.equal(summary.participatedChildren + summary.notParticipatedChildren, summary.targetChildren);
});
