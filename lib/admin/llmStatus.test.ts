import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { AI_RUNTIME_CODE_PATHS, getLlmStatusList } from "./llmStatus";

test("관리자 AI 런타임 목록은 실제 서비스 18개만 표시한다", () => {
  const previousLocation = process.env.GOOGLE_CLOUD_LOCATION;
  const previousSttKey = process.env.GCP_STT_API_KEY;
  const previousTtsKey = process.env.GCP_TTS_API_KEY;
  process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
  process.env.GCP_STT_API_KEY = "configured-for-test";
  process.env.GCP_TTS_API_KEY = "configured-for-test";

  try {
    const entries = getLlmStatusList();
    assert.equal(entries.length, 18);
    assert.equal(new Set(entries.map((entry) => entry.id)).size, 18);
    assert.equal(entries.filter((entry) => /health/i.test(entry.id)).length, 0);
    assert.equal(entries.filter((entry) => /fallback/i.test(entry.id)).length, 0);
    assert.deepEqual(entries.filter((entry) => entry.fallbackModel).map((entry) => entry.id), ["mission_lean", "mission_reaction"]);
    assert.equal(entries.find((entry) => entry.id === "gcp_stt")?.effectiveModel, "default");
    assert.equal(entries.find((entry) => entry.id === "gcp_tts")?.effectiveModel, "ko-KR-Wavenet-A");
    assert.equal(entries.find((entry) => entry.id === "premium_live_voice")?.sdk, "@google/genai");
    assert.equal(entries.find((entry) => entry.id === "vacation_event_detection")?.effectiveModel, "gemini-3.5-flash");
    assert.deepEqual(entries.find((entry) => entry.id === "embedding")?.internalPaths, ["lib/memory/vectorRetrieval.ts", "supabase/functions/_shared/batch.ts"]);
    assert.equal(entries.every((entry) => entry.region === "us-central1" || entry.region === "Global"), true);
    assert.equal(entries.every((entry) => entry.status === "정상"), true);
    assert.equal(JSON.stringify(entries).includes("configured-for-test"), false);
  } finally {
    if (previousLocation === undefined) delete process.env.GOOGLE_CLOUD_LOCATION;
    else process.env.GOOGLE_CLOUD_LOCATION = previousLocation;
    if (previousSttKey === undefined) delete process.env.GCP_STT_API_KEY;
    else process.env.GCP_STT_API_KEY = previousSttKey;
    if (previousTtsKey === undefined) delete process.env.GCP_TTS_API_KEY;
    else process.env.GCP_TTS_API_KEY = previousTtsKey;
  }
});

test("등록된 대표 호출부는 저장소에 실제로 존재한다", () => {
  for (const path of AI_RUNTIME_CODE_PATHS) {
    assert.equal(existsSync(path), true, `missing runtime path: ${path}`);
  }
});
