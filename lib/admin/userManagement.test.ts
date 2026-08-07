import assert from "node:assert/strict";
import test from "node:test";
import {
  isCreatedInKstDateRange,
  matchesInternalTestFilter,
  sortAdminUserRows,
  toChildLoginId,
} from "./userManagement";

test("아이 로컬 이메일은 화면용 로그인 아이디로 변환한다", () => {
  assert.equal(toChildLoginId("testa@kbestie.local"), "testa");
  assert.equal(toChildLoginId("parent@example.com"), "parent@example.com");
  assert.equal(toChildLoginId(null), "");
});

test("내부 테스트 기본값은 테스트 데이터를 제외한다", () => {
  assert.equal(matchesInternalTestFilter(false, "exclude"), true);
  assert.equal(matchesInternalTestFilter(true, "exclude"), false);
  assert.equal(matchesInternalTestFilter(true, "include"), true);
  assert.equal(matchesInternalTestFilter(false, "include"), true);
  assert.equal(matchesInternalTestFilter(true, "only"), true);
  assert.equal(matchesInternalTestFilter(false, "only"), false);
});

test("이름 정렬은 서로 다른 행을 비교하고 원본 배열을 보존한다", () => {
  const rows = [{ name: "하늘" }, { name: "가람" }, { name: "나래" }];
  const sorted = sortAdminUserRows(rows, "name_asc");
  assert.deepEqual(sorted.map((row) => row.name), ["가람", "나래", "하늘"]);
  assert.deepEqual(rows.map((row) => row.name), ["하늘", "가람", "나래"]);
});

test("최근 활동 정렬은 접속 시각을 보조값으로 사용한다", () => {
  const rows = [
    { name: "A", lastActivityAt: "2026-08-01T00:00:00Z" },
    { name: "B", lastSignInAt: "2026-08-03T00:00:00Z" },
  ];
  assert.deepEqual(sortAdminUserRows(rows, "activity_desc").map((row) => row.name), ["B", "A"]);
});

test("생성일 기간은 KST 날짜 경계를 사용한다", () => {
  const lateUtc = "2026-08-07T15:30:00.000Z";
  assert.equal(isCreatedInKstDateRange(lateUtc, "2026-08-08", "2026-08-08"), true);
  assert.equal(isCreatedInKstDateRange(lateUtc, "2026-08-07", "2026-08-07"), false);
  assert.equal(isCreatedInKstDateRange(null, "2026-08-01", ""), false);
});
