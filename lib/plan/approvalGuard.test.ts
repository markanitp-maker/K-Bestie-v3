import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkApprovalForChild,
  checkApprovalForSession,
} from "./approvalGuard.js";

test("053: 실제 생성된 아이는 과거 부모 베타 승인 상태로 차단하지 않는다", async () => {
  assert.equal(await checkApprovalForChild("child-id"), null);
});

test("053: 실제 생성된 아이 세션은 과거 부모 베타 승인 상태로 차단하지 않는다", async () => {
  assert.equal(await checkApprovalForSession("session-id"), null);
});
