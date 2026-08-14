import assert from "node:assert/strict";
import test from "node:test";
import { formatSupportDate, supportStatusLabel } from "./presentation";

test("부모와 아이에게 기존 CS 상태를 역할별 문구로 표시한다", () => {
  assert.equal(supportStatusLabel("open", "parent"), "접수 완료");
  assert.equal(supportStatusLabel("in_progress", "parent"), "처리 중");
  assert.equal(supportStatusLabel("resolved", "parent"), "처리 완료");
  assert.equal(supportStatusLabel("open", "child"), "접수됐어");
  assert.equal(supportStatusLabel("in_progress", "child"), "처리하고 있어");
  assert.equal(supportStatusLabel("resolved", "child"), "처리가 끝났어");
  assert.equal(supportStatusLabel("closed", "child"), "확인이 끝났어");
  assert.equal(supportStatusLabel("closed", "parent"), "종료");
});

test("날짜는 KST YYYY년 MM월 DD일 형식으로 고정한다", () => {
  assert.equal(formatSupportDate("2026-08-14T01:23:00.000Z"), "2026년 08월 14일 10:23");
});
