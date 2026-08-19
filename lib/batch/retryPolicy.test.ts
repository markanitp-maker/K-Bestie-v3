import assert from "node:assert/strict";
import { test } from "node:test";

import { isRetryableTransportError } from "./retryPolicy";

test("020 §3-12: 일시적 전송 오류는 재시도 대상이다", () => {
  for (const msg of [
    "429 RESOURCE_EXHAUSTED",
    "HTTP 503 Service Unavailable",
    "status 500",
    "fetch failed",
    "request timeout after 30s",
    "ECONNRESET",
    "DEADLINE_EXCEEDED",
  ]) {
    assert.equal(isRetryableTransportError(msg), true, `재시도해야 한다: ${msg}`);
  }
});

test("020 §3-12: 숫자 부분 일치로 영구 실패를 재시도하지 않는다", () => {
  // memoryV3 에 있던 errMsg.includes("50") 이 정확히 이 사고를 냈다 —
  // 영구 실패가 무한히 재큐잉된다.
  for (const msg of [
    "50 messages processed but schema invalid",
    "child_id 4f50a1 not found",
    "INVALID_ARGUMENT: bad request",
    "PERMISSION_DENIED",
    "JSON schema mismatch at field 502nd",
  ]) {
    assert.equal(isRetryableTransportError(msg), false, `재시도하면 안 된다: ${msg}`);
  }
});

test("020 §3-12: 빈 메시지는 재시도 대상이 아니다", () => {
  assert.equal(isRetryableTransportError(""), false);
});
