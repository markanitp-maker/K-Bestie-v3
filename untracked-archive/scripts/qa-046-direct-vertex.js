// 046-llm-change.md §13 "모델 직접 호출" 검증 — agy QA 세션이 3회 연속 크래시(agy CLI
// 자체 "timeout waiting for response")해 §12-C에 따라 메인 Claude가 직접 개입.
// 목적: Phase 4에서 고친 thinkingLevel 대문자 값이 실제 Vertex API에서 정상 동작하는지,
// 확정된 신규 모델들이 실제로 호출 가능한지 직접 검증한다(코드 수정 없음, 읽기+실행 전용).
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

async function run() {
  const env = fs.readFileSync('.env.local', 'utf8');
  const getEnv = (key) => {
    const match = env.match(new RegExp(`^${key}='?(.*?)'?$`, 'm'));
    return match ? match[1].trim() : null;
  };

  const saJsonStr = getEnv('GCP_VERTEX_SA_KEY_JSON');
  if (!saJsonStr) {
    console.error("GCP_VERTEX_SA_KEY_JSON not found");
    process.exit(1);
  }

  const sa = JSON.parse(saJsonStr);
  const project = getEnv('GOOGLE_CLOUD_PROJECT') || sa.project_id;
  const location = getEnv('GOOGLE_CLOUD_LOCATION') || 'global';

  console.log(`Project: ${project}, Location: ${location}`);

  const scenarios = [
    { name: "missionLean", model: "gemini-3.5-flash-lite", maxOutputTokens: 40, thinkingLevel: "MINIMAL" },
    { name: "missionReaction", model: "gemini-3.5-flash-lite", maxOutputTokens: 1024, thinkingLevel: "MINIMAL" },
    { name: "adminTextHealth", model: "gemini-3.5-flash", maxOutputTokens: 32, thinkingLevel: "MINIMAL" },
    { name: "parentMemoryQuery", model: "gemini-3.5-flash-lite", maxOutputTokens: 1024, thinkingLevel: "MINIMAL" },
    { name: "parentQuestionGeneration", model: "gemini-3.5-flash", maxOutputTokens: 1024, thinkingLevel: "LOW" },
    { name: "contextCorrection", model: "gemini-3.5-flash", maxOutputTokens: 8192, thinkingLevel: "LOW" },
    { name: "childAnswerClassification", model: "gemini-3.5-flash", maxOutputTokens: 1024, thinkingLevel: "LOW" },
    { name: "dailyReport", model: "gemini-3.6-flash", maxOutputTokens: 8192, thinkingLevel: "MEDIUM" },
    { name: "weeklyReport", model: "gemini-3.6-flash", maxOutputTokens: 8192, thinkingLevel: "MEDIUM" },
    { name: "missionLeanFallback", model: "gemini-3.5-flash", maxOutputTokens: 40, thinkingLevel: "MINIMAL" },
  ];

  try {
    const ai = new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { credentials: sa } });
    const results = [];

    for (const s of scenarios) {
      const start = Date.now();
      try {
        const response = await ai.models.generateContent({
          model: s.model,
          contents: "안녕! 짧게 한 문장으로 인사해줘.",
          config: {
            maxOutputTokens: s.maxOutputTokens,
            thinkingConfig: { thinkingLevel: s.thinkingLevel },
          },
        });
        const ms = Date.now() - start;
        const text = (response.text || "").trim();
        results.push({
          role: s.name, model: s.model, thinkingLevel: s.thinkingLevel,
          httpOk: true, modelVersion: response.modelVersion, ms,
          textLen: text.length, finishReason: response.candidates?.[0]?.finishReason,
        });
        console.log(`[OK] ${s.name} (${s.model}, thinking=${s.thinkingLevel}) — ${ms}ms, modelVersion=${response.modelVersion}, finishReason=${response.candidates?.[0]?.finishReason}, textLen=${text.length}`);
      } catch (err) {
        const ms = Date.now() - start;
        results.push({ role: s.name, model: s.model, thinkingLevel: s.thinkingLevel, httpOk: false, ms, error: err.message });
        console.error(`[FAIL] ${s.name} (${s.model}, thinking=${s.thinkingLevel}) — ${ms}ms, error=${err.message}`);
      }
    }

    const failed = results.filter(r => !r.httpOk);
    console.log(`\n=== 요약: ${results.length - failed.length}/${results.length} 성공 ===`);
    if (failed.length > 0) {
      console.log("실패 목록:", JSON.stringify(failed, null, 2));
      process.exitCode = 1;
    }
  } catch (e) {
    console.error("Setup error:", e);
    process.exitCode = 1;
  }
}
run();
