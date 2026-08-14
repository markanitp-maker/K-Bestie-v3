import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GUEST_RATE_LIMIT_MAX_REQUESTS,
  GUEST_RATE_LIMIT_WINDOW_MS,
  MAX_EMAIL_LENGTH,
  MAX_PAYLOAD_BYTES,
  POST,
  _resetGuestRateLimitsForTest,
  checkGuestRateLimit,
  getClientIp,
  isValidEmail,
  sweepExpiredRateLimits,
} from "./route";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("이메일 형식과 최대 길이를 검증한다", () => {
  assert.equal(isValidEmail("user@example.com"), true);
  assert.equal(isValidEmail("john.doe+test@sub.example.co.kr"), true);
  assert.equal(isValidEmail("  spaced@example.com  "), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("user@example"), false);
  assert.equal(isValidEmail("user@domain..com"), false);
  assert.equal(isValidEmail(null), false);

  const longEmail = `${"a".repeat(MAX_EMAIL_LENGTH)}@example.com`;
  assert.ok(longEmail.length > MAX_EMAIL_LENGTH);
  assert.equal(isValidEmail(longEmail), false);
});

test("클라이언트 IP는 전달 헤더 순서로 결정한다", () => {
  const forwarded = new Request("http://localhost/api/support", {
    headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" },
  });
  assert.equal(getClientIp(forwarded), "203.0.113.195");

  const realIp = new Request("http://localhost/api/support", {
    headers: { "x-real-ip": "198.51.100.1" },
  });
  assert.equal(getClientIp(realIp), "198.51.100.1");
  assert.equal(getClientIp(new Request("http://localhost/api/support")), "unknown");
});

test("비회원 IP rate limit은 허용 횟수와 만료를 지킨다", () => {
  _resetGuestRateLimitsForTest();
  const now = 100_000;
  for (let index = 0; index < GUEST_RATE_LIMIT_MAX_REQUESTS; index += 1) {
    assert.equal(checkGuestRateLimit("unknown", now), true);
  }
  assert.equal(checkGuestRateLimit("unknown", now), false);

  sweepExpiredRateLimits(now + GUEST_RATE_LIMIT_WINDOW_MS + 1);
  assert.equal(checkGuestRateLimit("unknown", now + GUEST_RATE_LIMIT_WINDOW_MS + 1), true);
  _resetGuestRateLimitsForTest();
});

test("랜딩 문의는 app_surface === 'landing'으로 판정하고 식별자를 null로 저장한다", () => {
  const landingBlock = source.slice(source.indexOf('if (app_surface === "landing")'), source.indexOf("// 2) 로그인"));
  assert.match(landingBlock, /if\s*\(app_surface\s*===\s*"landing"\)/);
  assert.match(landingBlock, /user_id:\s*null/);
  assert.match(landingBlock, /child_id:\s*null/);
  assert.match(landingBlock, /guardian_id:\s*null/);
  assert.match(landingBlock, /submitter_role:\s*"guest"/);
  assert.match(landingBlock, /category:\s*"inquiry"/);
  assert.match(landingBlock, /app_surface:\s*"landing"/);
  assert.match(landingBlock, /contact_email:\s*trimmedEmail/);
});

test("랜딩이 아닌 요청은 인증 사용자만 허용한다", () => {
  const authBlock = source.slice(source.indexOf("// 2) 로그인"));
  assert.match(authBlock, /if\s*\(!user\)\s*\{\s*return\s*NextResponse\.json\(\{\s*error:\s*"Unauthorized"\s*\}\s*,\s*\{\s*status:\s*401\s*\}\s*\);/);
});

test("멱등 확인은 rate limit보다 먼저 수행하고 landing/user 조건을 결합하여 격리한다", () => {
  const landingBlock = source.slice(source.indexOf('if (app_surface === "landing")'), source.indexOf("// 2) 로그인"));
  assert.ok(landingBlock.indexOf("if (idempotencyKey)") < landingBlock.indexOf("checkGuestRateLimit"));
  assert.match(landingBlock, /\.eq\("idempotency_key",\s*idempotencyKey\)/);
  assert.match(landingBlock, /\.eq\("app_surface",\s*"landing"\)/);
  assert.match(landingBlock, /\.is\("user_id",\s*null\)/);
  assert.match(landingBlock, /\.eq\("contact_email",\s*trimmedEmail\)/);
  assert.match(landingBlock, /insertErr\.code\s*===\s*"23505"/);
  assert.match(landingBlock, /existing\?\.request_number/);

  const authBlock = source.slice(source.indexOf("// 2) 로그인"));
  assert.match(authBlock, /\.eq\("idempotency_key",\s*idempotencyKey\)/);
  assert.match(authBlock, /\.eq\("user_id",\s*user\.id\)/);
});

test("민감한 문의 내용과 연락처를 로그에 남기지 않는다", () => {
  const logs = source.match(/console\.error\([^\n]+/g) ?? [];
  for (const log of logs) {
    assert.doesNotMatch(log, /contact_email|trimmedEmail|finalContent|clientIp/);
  }
});

test("기존 인증 사용자와 첨부 연결 계약을 보존한다", () => {
  assert.match(source, /normalizeSubmissionCategory\(submittedCategory\)/);
  assert.match(source, /linkAttachments\(serviceClient/);
  assert.match(source, /resolveChildForUser\(serviceClient,\s*user\.id\)/);
  assert.match(source, /user_id:\s*user\.id/);
});

test("선언 헤더 없이도 실제 UTF-8 본문 크기를 제한한다", async () => {
  const oversizedBody = JSON.stringify({ content: "가".repeat(MAX_PAYLOAD_BYTES) });
  const response = await POST(new Request("http://localhost/api/support", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: oversizedBody,
  }));
  assert.equal(response.status, 413);
});

test("잘못된 JSON과 배열 본문을 거절한다", async () => {
  const invalidResponse = await POST(new Request("http://localhost/api/support", {
    method: "POST",
    body: "invalid-json-content{",
  }));
  assert.equal(invalidResponse.status, 400);

  const arrayResponse = await POST(new Request("http://localhost/api/support", {
    method: "POST",
    body: "[]",
  }));
  assert.equal(arrayResponse.status, 400);
});

test("금지된 SDK와 Promise.all을 추가하지 않는다", () => {
  assert.doesNotMatch(source, /Promise\.all\(/);
  assert.doesNotMatch(source, /@google\/generative-ai/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_/);
});
