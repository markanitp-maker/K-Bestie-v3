import test from "node:test";
import assert from "node:assert/strict";
import { isPushTestChild } from "./pushTestEligibility";

const testFamilies = new Set(["test-family"]);

test("내부 테스트 플래그·QA 플래그·테스트 가족 중 하나면 허용한다", () => {
  assert.equal(isPushTestChild({ family_id: null, is_internal_test: true, is_test_account: false }, testFamilies), true);
  assert.equal(isPushTestChild({ family_id: null, is_internal_test: false, is_test_account: true }, testFamilies), true);
  assert.equal(isPushTestChild({ family_id: "test-family", is_internal_test: false, is_test_account: false }, testFamilies), true);
});

test("실사용자와 가족 미등록 사용자는 서버 가드에서 거부한다", () => {
  assert.equal(isPushTestChild({ family_id: "real-family", is_internal_test: false, is_test_account: false }, testFamilies), false);
  assert.equal(isPushTestChild({ family_id: null, is_internal_test: false, is_test_account: false }, testFamilies), false);
});
