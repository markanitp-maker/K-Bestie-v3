/**
 * 리포트(요약) 모델 등록부 — 순수 TS, 외부 import 없음.
 * Next.js(app/api/_lib/ai.ts)와 Supabase Edge Function(Deno, supabase/functions/_shared/batch.ts)
 * 양쪽에서 그대로 import해서 쓴다. 이 파일에 Next 전용 경로(@/...) 등 외부 import를 추가하지 말 것 —
 * Deno 번들러가 import 그래프 전체를 정적 분석하므로, 여기에 Next 전용 import가 들어가면
 * Edge Function 배포가 깨진다.
 */

export interface ReportModelConfig {
  modelId: string;
  maxOutputTokens: number;
}

// ── 리포트(요약) 모델 등록부 ─────────────────────────────────
export const REPORT_MODELS: Record<string, ReportModelConfig> = {
  "gemini-3.6-flash": {
    modelId: "gemini-3.6-flash",
    maxOutputTokens: 8192, // 충분한 토큰
  },
  "gemini-3.5-flash": {
    modelId: "gemini-3.5-flash",
    maxOutputTokens: 8192,
  },

  "gemma-4-31b-it": {
    modelId: "gemma-4-31b-it",
    maxOutputTokens: 8192,
  },
};

export function getReportModel(modelId: string): ReportModelConfig {
  const config = REPORT_MODELS[modelId];
  if (!config) {
    return { modelId, maxOutputTokens: 8192 };
  }
  return config;
}

export function getActiveReportModel(): ReportModelConfig {
  // 기본적으로 구버전 호환성을 위해 gemini-3.6-flash 반환 (실제로는 batch.ts에서 명시적으로 role 기반으로 가져옴)
  return getReportModel("gemini-3.6-flash");
}
