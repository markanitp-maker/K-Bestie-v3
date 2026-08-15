import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { notificationIdsFromRpc } from "./notifications";

test("RPC notification id 결과는 유효한 문자열만 Push 입력으로 사용한다", () => {
  assert.deepEqual(notificationIdsFromRpc(null), []);
  assert.deepEqual(notificationIdsFromRpc({ notification_ids: "bad" }), []);
  assert.deepEqual(notificationIdsFromRpc({ notification_ids: ["a", null, "", "b"] }), ["a", "b"]);
});

test("Push는 새 알림만 조회하고 child scope와 stale subscription을 처리한다", () => {
  const source = readFileSync(new URL("./notifications.ts", import.meta.url), "utf8");
  assert.match(source, /\.in\("id", uniqueIds\)/);
  assert.match(source, /\.in\("user_id", userIds\)/);
  assert.match(source, /subscription\.user_id === notification\.user_id/);
  assert.match(source, /subscription\.role === notification\.role/);
  assert.match(source, /subscription\.child_id === notification\.child_id/);
  assert.match(source, /Promise\.allSettled\(/);
  assert.match(source, /status === 404 \|\| status === 410/);
  assert.match(source, /getPushErrorCode\(deliveryResult\.reason\)/);
  assert.doesNotMatch(source, /Promise\.all\(/);
});
