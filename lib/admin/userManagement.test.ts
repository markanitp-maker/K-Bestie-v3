import assert from "node:assert/strict";
import test from "node:test";
import {
  asArray,
  isCreatedInKstDateRange,
  matchesInternalTestFilter,
  parseAdminUsersOverviewResponse,
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

test("배열이 누락된 런타임 값은 공통 컴포넌트에서 빈 배열로 안전하게 처리한다", () => {
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray([1, 2]), [1, 2]);
});

test("사용자 API는 롤링 배포 중 구버전 kpi 응답도 고정 contract로 정규화한다", () => {
  const response = parseAdminUsersOverviewResponse({
    tab: "parents",
    kpi: { families: 7, parents: 10, children: 14, pending: 1 },
    items: [],
    pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
    meta: {},
  });
  assert.equal(response.tab, "parents");
  assert.deepEqual(response.counts, { families: 7, parents: 10, children: 14, pending: 1 });
  assert.deepEqual(response.items, []);
});

test("성공 응답처럼 보여도 items가 없으면 렌더링 전에 명시적 오류로 전환한다", () => {
  assert.throws(() => parseAdminUsersOverviewResponse({
    counts: { families: 0, parents: 0, children: 0, pending: 0 },
    pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  }), /응답 형식/);
});
