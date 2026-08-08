import assert from "node:assert/strict";
import test from "node:test";
import { isCompletedParentMembership } from "./membershipState";

test("기존 가족에 합류한 parent는 아이 수와 무관하게 가입 완료다", () => {
  assert.equal(isCompletedParentMembership("parent", 0), true);
  assert.equal(isCompletedParentMembership("parent", 2), true);
});

test("새 가족의 owner_parent는 최초 아이 등록 전까지 가입 미완료다", () => {
  assert.equal(isCompletedParentMembership("owner_parent", 0), false);
  assert.equal(isCompletedParentMembership("owner_parent", 1), true);
});

test("아이 역할이나 멤버십 없음은 보호자 가입 완료로 판정하지 않는다", () => {
  assert.equal(isCompletedParentMembership("child", 1), false);
  assert.equal(isCompletedParentMembership(null, 1), false);
});
