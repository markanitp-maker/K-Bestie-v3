import assert from "node:assert/strict";
import test from "node:test";

import { pendingMissionTurnStorageKey } from "./pendingTurnStore.js";

test("pending turn은 계정·아이·날짜 scope별 key로 격리한다", () => {
  const first = pendingMissionTurnStorageKey("user-a:family-a:child-a:2026-08-14");
  const second = pendingMissionTurnStorageKey("user-b:family-a:child-b:2026-08-14");
  assert.notEqual(first, second);
  assert.match(first, /^scope:/);
});

test("scope 없는 기존 pending은 legacy key를 유지한다", () => {
  assert.equal(pendingMissionTurnStorageKey(), "current");
});
