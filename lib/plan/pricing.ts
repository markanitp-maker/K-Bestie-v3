// 대시보드용 사용량 단가/추정 비용 유틸 — 과금(billing) 정확도가 아니라 대략적인 리포팅 용도.
// STT/TTS 실제 청구액은 GCP billing_export(BigQuery)에서 별도로 가져온다(lib/billing/gcpBilling.ts).
// 여기 단가는 "우리 추정치"(청구 지연 시간대 표시, 아이별 원가 배분 등)에만 쓴다.
// 단가 출처: spec.md "1-3. 단가표" (초안).

// 라이브 오디오(시간 기반 폴백): 분당 60~80원 실측값의 중간값으로 추정.
// usageMetadata(토큰 카운트)가 있으면 아래 GEMINI_LIVE_* 공식 단가로 계산하고, 없을 때만 이 값을 쓴다.
export const LIVE_KRW_PER_MIN = 70;

// USD/KRW 환율 — 저장소 단일 소스(gcpBilling.ts 등에서 import). 고정 환율(근사)이며 실시간 FX는 백로그.
// 화면에는 이 값과 기준일(FX_AS_OF)을 '적용 환율·기준일'로 함께 표기한다(Plan01 §23.3).
export const USD_TO_KRW = 1400;
export const FX_AS_OF = "2026-07-22";

// Wavenet TTS: 100만 자당 약 $4 — 위 환율로 환산.
export const TTS_KRW_PER_MILLION_CHARS = 4 * USD_TO_KRW;

// STT: spec.md에 확정 단가 없음 — 실제 단가 확인 전까지 라이브와 동일 추정치 사용.
// TODO: 실제 STT 단가 확인되면 교체.
export const STT_KRW_PER_MIN = 70;

// ── Gemini Live API 공식 단가(AI Studio, Live 오디오 모델 기준) ──
// 출처: Plan2.md 지시 — 오디오 25 tokens/초, 입력 $3.00/1M 토큰(≈$0.005/분), 출력 $12.00/1M 토큰(≈$0.018/분).
export const LIVE_AUDIO_TOKENS_PER_SEC = 25;
export const GEMINI_LIVE_INPUT_USD_PER_M_TOKENS = 3.0;
export const GEMINI_LIVE_OUTPUT_USD_PER_M_TOKENS = 12.0;

/** usageMetadata의 prompt/response 토큰 카운트로 라이브 세션 비용(KRW)을 정밀 계산. */
export function estimateLiveCostFromTokens(input: { tokenIn: number; tokenOut: number }): number {
  const inputUsd = (input.tokenIn / 1_000_000) * GEMINI_LIVE_INPUT_USD_PER_M_TOKENS;
  const outputUsd = (input.tokenOut / 1_000_000) * GEMINI_LIVE_OUTPUT_USD_PER_M_TOKENS;
  return (inputUsd + outputUsd) * USD_TO_KRW;
}

// ── Gemini 텍스트(LLM) 공식 단가 ──
// 실사용 텍스트 모델은 lib/llm/modelRouter.ts의 역할별 설정을 따른다.
// 아래 값은 실제 청구가 아니라 관리자 추정치이며, 확정 청구액은 BigQuery Billing 데이터를 사용한다.
export const LLM_TEXT_INPUT_USD_PER_M_TOKENS = 0.3;
export const LLM_TEXT_OUTPUT_USD_PER_M_TOKENS = 2.5;

export function estimateLlmCostFromTokens(input: { tokenIn: number; tokenOut: number }): number {
  const inputUsd = (input.tokenIn / 1_000_000) * LLM_TEXT_INPUT_USD_PER_M_TOKENS;
  const outputUsd = (input.tokenOut / 1_000_000) * LLM_TEXT_OUTPUT_USD_PER_M_TOKENS;
  return (inputUsd + outputUsd) * USD_TO_KRW;
}

// ── 인프라 고정비(월 단위 근사치) ──
// 실제 청구서 확인 전 근사값 — Vercel Pro $20/월, Supabase Pro $25/월, 환율 1,500원 근사.
export const VERCEL_FIXED_KRW_PER_MONTH = 30_000;
export const SUPABASE_FIXED_KRW_PER_MONTH = 37_500;

// ── 매출 계산 모드 ──
// 지금은 2026-07~2026-12-31 전원 무료 제공 기간이라 실제 결제가 없다.
// 'projected': 전원 유료 전환을 가정한 예상 매출(plans.price_krw 기준)로 계산.
// 나중에 실제 결제가 붙으면 'actual'로 바꾸고 실제 결제 테이블 합계를 쓰도록 전환한다.
export const REVENUE_MODE: "projected" | "actual" = "projected";

export type UsageKind = "stt" | "tts" | "live_audio" | "llm";

/** 사용량 1건에 대한 대략적인 원화 비용 추정치.
 *  필수 값이 없으면 예외를 던지지 않고 0을 반환 — 대시보드 표시가 끊기지 않도록 하기 위함. */
export function estimateCost(input: {
  kind: UsageKind;
  durationSec?: number;
  charCount?: number;
  tokenIn?: number;
  tokenOut?: number;
}): number {
  const { kind, durationSec, charCount, tokenIn, tokenOut } = input;

  switch (kind) {
    case "live_audio":
      if (tokenIn != null && tokenOut != null) {
        return estimateLiveCostFromTokens({ tokenIn, tokenOut });
      }
      if (durationSec == null) return 0;
      return (durationSec / 60) * LIVE_KRW_PER_MIN;
    case "tts":
      if (charCount == null) return 0;
      return (charCount / 1_000_000) * TTS_KRW_PER_MILLION_CHARS;
    case "stt":
      if (durationSec == null) return 0;
      return (durationSec / 60) * STT_KRW_PER_MIN;
    case "llm":
      if (tokenIn == null || tokenOut == null) return 0;
      return estimateLlmCostFromTokens({ tokenIn, tokenOut });
    default:
      return 0;
  }
}
