import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { AI_RUNTIME_CODE_PATHS, getLlmStatusList } from "./llmStatus";

const KEYS = [
  "GCAI_ACTIVE_PROFILE", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GCP_VERTEX_SA_KEY_JSON",
  "GCAI_B_GOOGLE_CLOUD_PROJECT", "GCAI_B_GOOGLE_CLOUD_LOCATION", "GCAI_B_VERTEX_SA_KEY_JSON",
  "GCP_STT_API_KEY", "GCP_TTS_API_KEY",
] as const;

function withEnvironment(values: Partial<Record<(typeof KEYS)[number], string | undefined>>, run: () => void) {
  const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { run(); } finally {
    for (const key of KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const configured = {
  GCAI_ACTIVE_PROFILE: "A",
  GOOGLE_CLOUD_PROJECT: "qa-project",
  GCP_VERTEX_SA_KEY_JSON: "configured-for-test",
  GCP_STT_API_KEY: "configured-for-test",
  GCP_TTS_API_KEY: "configured-for-test",
} as const;

test("Vercel location 미설정은 실제 factory와 동일하게 global 정상 처리한다", () => {
  withEnvironment(configured, () => {
    const entries = getLlmStatusList();
    const vercelEntries = entries.filter((entry) => entry.runtime === "Vercel Node");
    assert.equal(entries.length, 18);
    assert.equal(vercelEntries.length > 0, true);
    assert.equal(vercelEntries.every((entry) => entry.endpointLocation === "global" && entry.status === "정상"), true);
    assert.equal(JSON.stringify(entries).includes("실제 리전이 us-central1이 아니라 global입니다."), false);
  });
});

test("Edge·Cloud Run·REST·Embedding을 runtime별 endpoint/location으로 표시한다", () => {
  withEnvironment({ ...configured, GOOGLE_CLOUD_LOCATION: "global" }, () => {
    const entries = getLlmStatusList();
    assert.equal(entries.find((entry) => entry.id === "supabase_batch_report")?.endpointLocation, "us-central1");
    assert.equal(entries.find((entry) => entry.id === "premium_live_voice")?.endpointLocation, "us-central1");
    assert.equal(entries.find((entry) => entry.id === "gcp_stt")?.endpointLocation, "Global REST API");
    assert.equal(entries.find((entry) => entry.id === "gcp_tts")?.endpointLocation, "Global REST API");
    assert.equal(entries.find((entry) => entry.id === "embedding")?.endpointLocation, "Vercel: global / Edge: us-central1");
    assert.equal(entries.every((entry) => entry.status === "정상"), true);
  });
});

test("STT/TTS는 각 REST API key만 검사하고 Vertex location을 적용하지 않는다", () => {
  withEnvironment({ ...configured, GOOGLE_CLOUD_LOCATION: "unsupported-location", GCP_STT_API_KEY: undefined }, () => {
    const entries = getLlmStatusList();
    const stt = entries.find((entry) => entry.id === "gcp_stt")!;
    const tts = entries.find((entry) => entry.id === "gcp_tts")!;
    assert.equal(stt.status, "오류");
    assert.match(stt.statusReason ?? "", /GCP_STT_API_KEY/);
    assert.equal(tts.status, "정상");
    assert.equal((tts.statusReason ?? "").includes("location"), false);
  });
});

test("지원 범위 밖 location과 필수 Vertex 인증 누락만 오류로 판정한다", () => {
  withEnvironment({ ...configured, GOOGLE_CLOUD_LOCATION: "moon-1", GCP_VERTEX_SA_KEY_JSON: undefined }, () => {
    const entry = getLlmStatusList().find((row) => row.id === "mission_general")!;
    assert.equal(entry.status, "오류");
    assert.match(entry.statusReason ?? "", /moon-1/);
    assert.match(entry.statusReason ?? "", /GCP_VERTEX_SA_KEY_JSON/);
  });
});

test("관리자 AI 런타임 목록은 실제 서비스 18개만 유지한다", () => {
  withEnvironment(configured, () => {
    const entries = getLlmStatusList();
    assert.equal(entries.length, 18);
    assert.equal(new Set(entries.map((entry) => entry.id)).size, 18);
    assert.equal(entries.filter((entry) => /health/i.test(entry.id)).length, 0);
    assert.equal(entries.filter((entry) => /fallback/i.test(entry.id)).length, 0);
    assert.deepEqual(entries.filter((entry) => entry.fallbackModel).map((entry) => entry.id), ["mission_lean", "mission_reaction"]);
    assert.equal(entries.find((entry) => entry.id === "gcp_stt")?.effectiveModel, "default");
    assert.equal(entries.find((entry) => entry.id === "gcp_tts")?.effectiveModel, "ko-KR-Wavenet-A");
    assert.equal(entries.find((entry) => entry.id === "vacation_event_detection")?.effectiveModel, "gemini-3.5-flash");
    assert.deepEqual(entries.find((entry) => entry.id === "embedding")?.internalPaths, ["lib/memory/vectorRetrieval.ts", "supabase/functions/_shared/batch.ts"]);
    assert.equal(JSON.stringify(entries).includes("configured-for-test"), false);
  });
});

test("등록된 대표 호출부는 저장소에 실제로 존재한다", () => {
  for (const path of AI_RUNTIME_CODE_PATHS) assert.equal(existsSync(path), true, `missing runtime path: ${path}`);
});
