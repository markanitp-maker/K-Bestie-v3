/**
 * 리포트(요약) 모델 등록부 — 순수 TS, 외부 import 없음.
 * Next.js(app/api/_lib/ai.ts)와 Supabase Edge Function(Deno, supabase/functions/_shared/batch.ts)
 * 양쪽에서 그대로 import해서 쓴다. 이 파일에 Next 전용 경로(@/...) 등 외부 import를 추가하지 말 것 —
 * Deno 번들러가 import 그래프 전체를 정적 분석하므로, 여기에 Next 전용 import가 들어가면
 * Edge Function 배포가 깨진다.
 */

export interface ReportModelConfig {
  modelId: string;
  apiBase: string;
  maxOutputTokens: number;
}

// ── 리포트(요약) 모델 등록부 ─────────────────────────────────
export const REPORT_MODELS: Record<string, ReportModelConfig> = {
  // JSON 모드 안정 지원 — 리포트 생성 기본값
  "gemini-2.5-flash": {
    modelId: "gemini-2.5-flash",
    apiBase: "https://generativelanguage.googleapis.com",
    maxOutputTokens: 1024,
  },
  // Gemma 계열 (JSON 모드 불안정 — 필요 시 프롬프트 튜닝 필요)
  "gemma-4-31b-it": {
    modelId: "gemma-4-31b-it",
    apiBase: "https://generativelanguage.googleapis.com",
    maxOutputTokens: 1024,
  },
};

// 여기만 바꾸면 전체 적용
export const ACTIVE_REPORT_MODEL_ID = "gemini-2.5-flash";

export function getActiveReportModel(): ReportModelConfig {
  const config = REPORT_MODELS[ACTIVE_REPORT_MODEL_ID];
  if (!config) throw new Error(`Unknown report model: ${ACTIVE_REPORT_MODEL_ID}`);
  return config;
}
