import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("1차 완료 아이는 2차 cron 알림 대상에서 제외할 수 있도록 완료 조회가 하루 전체 기준이다", () => {
  const completedQuery = routeSource.slice(
    routeSource.indexOf('db.from("chat_sessions")'),
    routeSource.indexOf('db.from("mission_notification_logs")')
  );

  assert.match(completedQuery, /mission_progress\.business_date", businessDate/);
  assert.match(completedQuery, /mission_progress\.status", "COMPLETED"/);
  assert.doesNotMatch(completedQuery, /mission_progress\.round_type/);
});
