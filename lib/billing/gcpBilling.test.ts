import { test } from "node:test";
import assert from "node:assert/strict";
import { BigQuery } from "@google-cloud/bigquery";
import { classifyBillingRow, classifyGeminiDimension, fetchGcpBilling, KNOWN_BILLING_CATEGORIES } from "./gcpBilling";

// 2026-07-27 실제 billing_export 표본(2026-07-01~28)에서 확인한 service/sku 문자열 기준 분류 검증.
test("STT: 실제 service는 'Cloud Speech API'", () => {
  assert.equal(classifyBillingRow("Cloud Speech API", "Cloud Speech-to-Text Audio Length Standard"), "stt");
  assert.equal(classifyBillingRow("Cloud Speech-to-Text API", "anything"), "stt");
});

test("TTS: 'Cloud Text-to-Speech API'", () => {
  assert.equal(classifyBillingRow("Cloud Text-to-Speech API", "Count of characters for using wavenet voices"), "tts");
  assert.notEqual(classifyBillingRow("Cloud Text-to-Speech API", "x"), "stt");
});

test("Vertex AI Gemini text prediction은 모델 버전과 무관하게 동일 family로 분류", () => {
  for (const version of ["2.5", "3.1", "3.5", "3.5 Flash Lite", "3.6", "4.0"]) {
    assert.equal(classifyBillingRow("Vertex AI", `Gemini ${version} Global Text Input - Predictions`), "vertex_ai_gemini");
    assert.equal(classifyBillingRow("Vertex AI", `Gemini ${version} Global Text Output - Predictions`), "vertex_ai_gemini");
  }
});

test("Vertex AI Live audio와 Embeddings는 독립 family로 분류", () => {
  assert.equal(classifyBillingRow("Vertex AI", "Gemini 2.5 Flash Live Audio (AV2A) Output - Predictions"), "live_realtime_audio");
  assert.equal(classifyBillingRow("Vertex AI", "Gemini 3.6 Flash Live Audio Input - Predictions"), "live_realtime_audio");
  assert.equal(classifyBillingRow("Vertex AI", "Large Text Embedding Model - Predictions"), "vertex_ai_embeddings");
  assert.equal(classifyBillingRow("Vertex AI", "Vertex Embeddings Text Embedding"), "vertex_ai_embeddings");
});

test("Cloud Run(라이브 릴레이) → cloud_run", () => {
  assert.equal(classifyBillingRow("Cloud Run", "Cloud Run CPU Allocation Time"), "cloud_run");
  assert.equal(classifyBillingRow("Cloud Run", "Cloud Run Memory Allocation Time"), "cloud_run");
});

test("Cloud Storage → cloud_storage", () => {
  assert.equal(classifyBillingRow("Cloud Storage", "Standard Storage"), "cloud_storage");
});

test("운영 인프라 서비스는 독립 카테고리로 분류하고 알 수 없는 서비스만 other 유지", () => {
  assert.equal(classifyBillingRow("Cloud Logging", "Log Volume"), "cloud_logging");
  assert.equal(classifyBillingRow("BigQuery", "Analysis"), "bigquery");
  assert.equal(classifyBillingRow("Artifact Registry", "Storage"), "artifact_registry");
  assert.equal(classifyBillingRow("Secret Manager", "Active Secret Versions"), "secret_manager");
  assert.equal(classifyBillingRow("Compute Engine", "N1 Predefined Instance Core"), "other");
});

test("Vertex AI라도 알려진 SKU family가 아니면 other로 남긴다", () => {
  assert.equal(classifyBillingRow("Vertex AI", "Unknown Future SKU"), "other");
});

test("Gemini SKU 세부 사용형태 분류(모델 단위 임의배분 금지 — SKU 문자열로만 판별)", () => {
  assert.equal(classifyGeminiDimension("Gemini 2.5 Flash Live Audio Input - Predictions"), "input_audio");
  assert.equal(classifyGeminiDimension("Gemini 2.5 Flash Live Audio (AV2A) Output - Predictions"), "output_audio");
  assert.equal(classifyGeminiDimension("Gemini 2.5 Flash Live Text Input - Predictions"), "text_input");
  assert.equal(classifyGeminiDimension("Gemini 2.5 Flash GA Text Output (Thinking On) - Predictions"), "text_output");
  assert.equal(classifyGeminiDimension("Gemini 2.5 Flash GA Thinking Text Output - Predictions"), "text_output");
  assert.equal(classifyGeminiDimension("Gemini 3.1 Flash Lite Global Text Input - Predictions"), "text_input");
});

test("KNOWN_BILLING_CATEGORIES는 other를 제외한 운영 11종", () => {
  assert.equal(KNOWN_BILLING_CATEGORIES.length, 11);
  assert.ok(!KNOWN_BILLING_CATEGORIES.includes("other" as never));
});

// ── 실측 데이터 회귀 테스트(2026-07-01~28) ──
// 대표님이 별도 검증한 확정 수치와 정확히 일치해야 한다. GCP_BILLING_SA_KEY_JSON이
// 설정된 환경(로컬/CI 시크릿 보유)에서만 실행되고, 미설정 환경에서는 건너뛴다
// (fetchGcpBilling 자체의 "configured:false 폴백" 계약과 동일한 원칙).
const hasLiveBillingCreds = !!process.env.GCP_BILLING_SA_KEY_JSON && !!process.env.GCP_BILLING_PROJECT_ID && !!process.env.GCP_BILLING_DATASET;

// claude-review 지적: gcpBilling.ts 자체 주석대로 GCP billing export는 통상 하루 지연
// 반영된다 — 이 테스트를 range 종료일(07-28 00:00 UTC, 즉 07-27 하루 전체 포함) 직후에
// 실행하면 그날 데이터가 아직 정산 완료되지 않아 하드코딩된 기대값과 어긋날 수 있다.
// range 종료 시점으로부터 최소 3일 지난 뒤에만 실행되도록 스킵 조건에 반영한다.
const RANGE_END = new Date("2026-07-28T00:00:00Z");
const daysSinceRangeEnd = (Date.now() - RANGE_END.getTime()) / 86_400_000;
const exportSettled = daysSinceRangeEnd >= 3;

function roundKrw(n: number): number {
  return Math.round(n) || 0; // -0을 0으로 정규화(assert.equal은 Object.is 기반이라 -0 ≠ 0으로 판정한다)
}

test(
  "2026-07-01~28 실측 검증: gross=25,142 / credit=-25,142 / net=0 (반올림 전후 모두 BigQuery 원본과 일치)",
  {
    skip: !hasLiveBillingCreds
      ? "GCP billing 자격증명 미설정 — 건너뜀"
      : !exportSettled
        ? "billing export 정산 지연 위험 구간(range 종료 3일 이내) — 건너뜀"
        : false,
  },
  async () => {
    const from = new Date("2026-07-01T00:00:00Z");
    const to = RANGE_END;
    const result = await fetchGcpBilling({ from, to });
    assert.equal(result.configured, true, result.error);

    // 반올림 전(소수 그대로) — 대표님 검증치 근사 일치(±1원 이내, BigQuery 부동소수 누적오차 허용)
    assert.ok(Math.abs(result.total.grossCostKrw - 25142.14) < 1, `gross=${result.total.grossCostKrw}`);
    assert.ok(Math.abs(result.total.creditKrw - -25142.14) < 1, `credit=${result.total.creditKrw}`);
    assert.ok(Math.abs(result.total.netCostKrw - 0) < 1, `net=${result.total.netCostKrw}`);

    // 반올림 후(원 단위 표시값) — 대표님 검증치와 정확히 일치
    assert.equal(roundKrw(result.total.grossCostKrw), 25142);
    assert.equal(roundKrw(result.total.netCostKrw), 0);

    // 서비스별 검증치
    assert.ok(Math.abs(result.totalsByCategory.stt.grossCostKrw - 6369.11) < 1, `stt=${result.totalsByCategory.stt.grossCostKrw}`);
    assert.ok(Math.abs(result.totalsByCategory.cloud_run.grossCostKrw - 769.28) < 1, `cloud_run=${result.totalsByCategory.cloud_run.grossCostKrw}`);
    assert.ok(Math.abs(result.totalsByCategory.cloud_storage.grossCostKrw - 8.16) < 1, `cloud_storage=${result.totalsByCategory.cloud_storage.grossCostKrw}`);
    const vertexGross = result.totalsByCategory.vertex_ai_gemini.grossCostKrw + result.totalsByCategory.live_realtime_audio.grossCostKrw;
    assert.ok(Math.abs(vertexGross - 17996) < 5, `vertex=${vertexGross}`);

    // 행 합계·서비스 합계·전체 합계 정합성 — SKU 행(skuRows) 합이 서비스 합(totalsByCategory) 합과,
    // 서비스 합이 전체 합(total)과 반올림 전/후 모두 일치해야 한다.
    const rowSumGross = result.skuRows.reduce((s, r) => s + r.cost.grossCostKrw, 0);
    const categorySumGross = KNOWN_BILLING_CATEGORIES.reduce((s, c) => s + result.totalsByCategory[c].grossCostKrw, 0) + result.totalsByCategory.other.grossCostKrw;
    assert.ok(Math.abs(rowSumGross - categorySumGross) < 0.01, "행 합계 ≠ 서비스 합계(반올림 전)");
    assert.ok(Math.abs(categorySumGross - result.total.grossCostKrw) < 0.01, "서비스 합계 ≠ 전체 합계(반올림 전)");
    assert.equal(roundKrw(rowSumGross), roundKrw(result.total.grossCostKrw), "행 합계 ≠ 전체 합계(반올림 후)");

    // 미분류(other)는 전액 무료 메터링 서비스라 사실상 0에 수렴 — 1% 경고 임계를 넘지 않아야 한다.
    assert.ok(result.unclassified.ratePct < 1, `unclassified.ratePct=${result.unclassified.ratePct}`);
  }
);
