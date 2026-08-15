import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSupportDiscordPayload,
  notifyDiscordOfNewSupportRequest,
  truncateContent,
} from "./discord";

test("카테고리 3종이 각각 버그/건의/문의로 매핑되고 수식어와 이모지가 없다", () => {
  const baseNotice = {
    requestNumber: "REQ-260815-TEST",
    requestId: "00000000-0000-0000-0000-000000000001",
    appSurface: "child_app",
    createdAt: "2026-08-15T01:00:00.000Z",
    title: "버그 제목",
    content: "버그 내용입니다.",
  };

  const bugPayload = buildSupportDiscordPayload({ ...baseNotice, category: "bug" }, "https://k-bestie-v3-dev.vercel.app");
  const suggestionPayload = buildSupportDiscordPayload({ ...baseNotice, category: "suggestion", title: "건의 제목" }, "https://k-bestie-v3-dev.vercel.app");
  const inquiryPayload = buildSupportDiscordPayload({ ...baseNotice, category: "inquiry", title: "문의 제목" }, "https://k-bestie-v3-dev.vercel.app");

  const bugTypeField = bugPayload.embeds[0].fields.find((f) => f.name === "유형");
  const suggestionTypeField = suggestionPayload.embeds[0].fields.find((f) => f.name === "유형");
  const inquiryTypeField = inquiryPayload.embeds[0].fields.find((f) => f.name === "유형");

  assert.equal(bugTypeField?.value, "버그");
  assert.equal(suggestionTypeField?.value, "건의");
  assert.equal(inquiryTypeField?.value, "문의");

  for (const payload of [bugPayload, suggestionPayload, inquiryPayload]) {
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /새로운|신고|📨|💡|🐞/);
  }
});

test("20글자 이하 본문은 그대로 유지되고 초과 본문은 코드포인트 20글자 + … 로 잘린다", () => {
  assert.equal(truncateContent("12345678901234567890"), "12345678901234567890");
  assert.equal(truncateContent("짧은 문의 내용"), "짧은 문의 내용");
  assert.equal(truncateContent("123456789012345678901"), "12345678901234567890…");

  const koreanLong = "동해물과 백두산이 마르고 닳도록 하느님이 보우하사 우리나라 만세";
  const koreanTruncated = truncateContent(koreanLong);
  assert.equal(Array.from(koreanTruncated).length, 21); // 20자 + …
  assert.equal(koreanTruncated, Array.from(koreanLong).slice(0, 20).join("") + "…");

  const emojiLong = "😀".repeat(25);
  const emojiTruncated = truncateContent(emojiLong);
  assert.equal(Array.from(emojiTruncated).length, 21);
  assert.equal(emojiTruncated, "😀".repeat(20) + "…");
});

test("Discord payload는 유형, 제목, 내용 3개 항목만 포함하고 접수번호/출처/접수시각은 제외한다", () => {
  const payload = buildSupportDiscordPayload({
    category: "bug",
    requestNumber: "REQ-260815-EXCLUDE",
    requestId: "00000000-0000-0000-0000-000000000099",
    appSurface: "child_app",
    createdAt: "2026-08-15T09:00:00.000Z",
    title: "로그인 오류가 발생합니다",
    content: "모바일 화면에서 로그인 버튼을 눌렀을 때 응답이 없습니다. 확인 부탁드립니다.",
  }, "https://k-bestie-v3-dev.vercel.app");

  const embed = payload.embeds[0];
  const fieldNames = embed.fields.map((f) => f.name);
  assert.deepEqual(fieldNames, ["유형", "제목", "내용"]);

  const titleField = embed.fields.find((f) => f.name === "제목");
  const contentField = embed.fields.find((f) => f.name === "내용");
  assert.equal(titleField?.value, "로그인 오류가 발생합니다");
  assert.equal(contentField?.value, "모바일 화면에서 로그인 버튼을 눌렀을…");

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /접수번호/);
  assert.doesNotMatch(serialized, /REQ-260815-EXCLUDE/);
  assert.doesNotMatch(serialized, /출처/);
  assert.doesNotMatch(serialized, /child_app|랜딩페이지|부모 앱/);
  assert.doesNotMatch(serialized, /접수시각/);
  assert.doesNotMatch(serialized, /2026-08-15T09:00:00.000Z/);

  // url과 color는 보존
  assert.equal(embed.url, "https://k-bestie-v3-dev.vercel.app/admin/customer-requests?requestId=00000000-0000-0000-0000-000000000099");
  assert.equal(embed.color, 0xdc2626);
});

test("웹훅 미설정 시 not_configured를 반환한다", async () => {
  const originalUrl = process.env.DISCORD_SUPPORT_WEBHOOK_URL;
  delete process.env.DISCORD_SUPPORT_WEBHOOK_URL;
  try {
    const result = await notifyDiscordOfNewSupportRequest({
      category: "inquiry",
      requestNumber: "REQ-260815-NOTCONFIG",
      requestId: "00000000-0000-0000-0000-000000000002",
      appSurface: "landing",
      createdAt: "2026-08-15T00:00:00.000Z",
      title: "랜딩 문의",
      content: "문의 내용",
    }, "https://k-bestie-v3-dev.vercel.app");
    assert.deepEqual(result, { outcome: "not_configured" });
  } finally {
    if (originalUrl !== undefined) {
      process.env.DISCORD_SUPPORT_WEBHOOK_URL = originalUrl;
    }
  }
});

test("Discord secret은 서버 전용이고 실패는 접수를 깨뜨리지 않으며 URL을 로깅하지 않는다", () => {
  const source = readFileSync(new URL("./discord.ts", import.meta.url), "utf8");
  assert.match(source, /process\.env\.DISCORD_SUPPORT_WEBHOOK_URL/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_DISCORD/);
  assert.match(source, /return \{ outcome: "failed" as const \}/);
  assert.doesNotMatch(source, /console\.(error|warn)\([^\n]*webhookUrl/);
});

