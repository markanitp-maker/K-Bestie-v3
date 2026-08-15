import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSupportDiscordPayload } from "./discord";

test("Discord payload는 최소 운영 정보와 관리자 상세 query만 포함한다", () => {
  const payload = buildSupportDiscordPayload({
    category: "bug",
    requestNumber: "REQ-260814-TEST",
    requestId: "00000000-0000-0000-0000-000000000001",
    appSurface: "child_app",
    createdAt: "2026-08-14T01:00:00.000Z",
  }, "https://k-bestie-v3-dev.vercel.app");
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /새로운 버그 신고/);
  assert.match(serialized, /REQ-260814-TEST/);
  assert.match(serialized, /아이 앱/);
  assert.match(serialized, /requestId=00000000-0000-0000-0000-000000000001/);
  assert.doesNotMatch(serialized, /body|contact_email|user_id|child_id|guardian_id|signed_url|admin_note/);
});

test("Discord secret은 서버 전용이고 실패는 접수를 깨뜨리지 않는다", () => {
  const source = readFileSync(new URL("./discord.ts", import.meta.url), "utf8");
  assert.match(source, /process\.env\.DISCORD_SUPPORT_WEBHOOK_URL/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_DISCORD/);
  assert.match(source, /return \{ outcome: "failed" as const \}/);
  assert.doesNotMatch(source, /console\.error\([^\n]+webhookUrl/);
});
