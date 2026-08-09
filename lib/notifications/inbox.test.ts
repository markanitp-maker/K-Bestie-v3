import test from "node:test";
import assert from "node:assert/strict";
import { serializeNotification } from "./inbox.js";

test("알림 직렬화는 read_at을 유일한 읽음 상태로 유지한다", () => {
  const item = serializeNotification({
    id: "n1", user_id: "u1", child_id: "c1", role: "child", type: "mission",
    title: "미션 시작", body: "시작해요", target_url: "/child/missions",
    source_id: "source", created_at: "2026-08-09T00:00:00.000Z", read_at: null, expires_at: null,
  });
  assert.equal(item.readAt, null);
  assert.equal(item.targetUrl, "/child/missions");
  assert.equal("read" in item, false);
});

test("외부 URL은 앱 내부 루트로 강제한다", () => {
  const item = serializeNotification({
    id: "n2", user_id: "u1", child_id: null, role: "parent", type: "system",
    title: "안내", body: "안내", target_url: "https://evil.example",
    source_id: null, created_at: "2026-08-09T00:00:00.000Z", read_at: "2026-08-09T01:00:00.000Z", expires_at: null,
  });
  assert.equal(item.targetUrl, "/");
  assert.equal(item.readAt, "2026-08-09T01:00:00.000Z");
});
