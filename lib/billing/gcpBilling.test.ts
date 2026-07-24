import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBillingRow } from "./gcpBilling";

// 2026-07-22 실제 billing_export 표본에서 확인한 service/sku 문자열 기준 분류 검증.
test("STT: 실제 service는 'Cloud Speech API' (구 'Cloud Speech-to-Text API' 가정 버그 수정)", () => {
  assert.equal(classifyBillingRow("Cloud Speech API", "Cloud Speech-to-Text Audio Length Standard"), "stt");
  assert.equal(classifyBillingRow("Cloud Speech-to-Text API", "anything"), "stt");
});

test("TTS: 'Cloud Text-to-Speech API'", () => {
  assert.equal(classifyBillingRow("Cloud Text-to-Speech API", "Count of characters for using wavenet voices"), "tts");
  // text-to-speech가 speech보다 우선 분류되어 tts로 감(오분류 방지)
  assert.notEqual(classifyBillingRow("Cloud Text-to-Speech API", "x"), "stt");
});

test("Vertex Live(오디오/텍스트/AV2A) → live_audio", () => {
  assert.equal(classifyBillingRow("Vertex AI", "Gemini 2.5 Flash Live Audio (AV2A) Output - Predictions"), "live_audio");
  assert.equal(classifyBillingRow("Vertex AI", "Gemini 2.5 Flash Live Audio Input - Predictions"), "live_audio");
  assert.equal(classifyBillingRow("Vertex AI", "Gemini 2.5 Flash Live Text Input - Predictions"), "live_audio");
});

test("Vertex 일반 LLM(GA Text/Thinking) → llm", () => {
  assert.equal(classifyBillingRow("Vertex AI", "Gemini 2.5 Flash GA Text Input - Predictions"), "llm");
  assert.equal(classifyBillingRow("Vertex AI", "Gemini 2.5 Flash GA Thinking Text Output - Predictions"), "llm");
});

test("Cloud Run(라이브 릴레이) → cloud_run", () => {
  assert.equal(classifyBillingRow("Cloud Run", "Cloud Run CPU Allocation Time"), "cloud_run");
  assert.equal(classifyBillingRow("Cloud Run", "Cloud Run Memory Allocation Time"), "cloud_run");
});

test("대상 아닌 서비스는 null", () => {
  assert.equal(classifyBillingRow("Cloud Storage", "Standard Storage"), null);
  assert.equal(classifyBillingRow("Compute Engine", "N1 Predefined Instance Core"), null);
});
