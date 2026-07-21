/**
 * AI 모델 스위치 레이어
 * 모델 교체 시 이 파일의 ACTIVE_* 상수만 변경 — 호출 코드 불변
 */

import { GoogleGenAI } from "@google/genai";
import { createServiceClient } from "@/lib/supabase/server";
import {
  type ReportModelConfig,
  REPORT_MODELS,
  ACTIVE_REPORT_MODEL_ID,
  getActiveReportModel,
} from "./reportModel";

// 리포트(요약) 모델 등록부는 app/api/_lib/reportModel.ts로 이동했다(Deno Edge Function도
// 그 파일을 그대로 import해야 해서, 외부 import가 없는 순수 TS로 분리해둔 것). 기존 호출부
// 하위 호환을 위해 여기서 재수출한다.
export { type ReportModelConfig, REPORT_MODELS, ACTIVE_REPORT_MODEL_ID, getActiveReportModel };

export interface VoiceModelConfig {
  modelId: string;
  apiBase: string;
  inputSampleRate: number;
  outputSampleRate: number;
}

export interface MissionModelConfig {
  modelId: string;
  apiBase: string;
  maxOutputTokens: number;
}

// ── 음성 모델 등록부 ──────────────────────────────────────────
export const VOICE_MODELS: Record<string, VoiceModelConfig> = {
  // 3.1 live preview: 공식 transcription 지원 모델, 한 이벤트에 오디오+트랜스크립션 동시 전송
  "gemini-3.1-flash-live-preview": {
    modelId: "gemini-3.1-flash-live-preview",
    apiBase: "https://generativelanguage.googleapis.com",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
  // native-audio preview (보관용 — transcription 이벤트 미발송 확인)
  "gemini-2.5-flash-native-audio-preview-12-2025": {
    modelId: "gemini-2.5-flash-native-audio-preview-12-2025",
    apiBase: "https://generativelanguage.googleapis.com",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
  // half-cascade: STT→텍스트→TTS 방식
  "gemini-2.5-flash-live-001": {
    modelId: "gemini-2.5-flash-live-001",
    apiBase: "https://generativelanguage.googleapis.com",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
  // fallback 2.0 계열
  "gemini-2.0-flash-live-001": {
    modelId: "gemini-2.0-flash-live-001",
    apiBase: "https://generativelanguage.googleapis.com",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
  // native-audio latest (보관용)
  "gemini-2.5-flash-native-audio-latest": {
    modelId: "gemini-2.5-flash-native-audio-latest",
    apiBase: "https://generativelanguage.googleapis.com",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
};

// ── 미션 대화(그룹B) 모델 등록부 ─────────────────────────────
export const MISSION_MODELS: Record<string, MissionModelConfig> = {
  // 테스트 단계 비용 절감을 위해 flash-lite로 임시 통일(2026-07-12).
  "gemini-flash-lite-latest": {
    modelId: "gemini-flash-lite-latest",
    apiBase: "https://generativelanguage.googleapis.com",
    maxOutputTokens: 1024,
  },
};

// ── 현재 활성 모델 (여기만 바꾸면 전체 적용) ─────────────────
// Tier3(Premium, Live API 음성) 전용 모델 — 공식 transcription 지원(gemini-3.1-flash-live-preview).
export const ACTIVE_VOICE_MODEL_ID = "gemini-3.1-flash-live-preview";
export const ACTIVE_MISSION_MODEL_ID = "gemini-flash-lite-latest";

// Vertex Live 릴레이(Cloud Run, services/vertex-live-relay) 전용 모델 ID.
// AI Studio Live와 인증/연결 방식이 완전히 달라(서버 릴레이 필요) VOICE_MODELS 레지스트리에는
// 넣지 않는다 — /api/voice/token이 provider="vertex"일 때 이 값을 그대로 반환한다.
export const VERTEX_LIVE_VOICE_MODEL_ID = "gemini-live-2.5-flash-native-audio";

export function getActiveVoiceModel(): VoiceModelConfig {
  const config = VOICE_MODELS[ACTIVE_VOICE_MODEL_ID];
  if (!config) throw new Error(`Unknown voice model: ${ACTIVE_VOICE_MODEL_ID}`);
  return config;
}

export function getActiveMissionModel(): MissionModelConfig {
  const config = MISSION_MODELS[ACTIVE_MISSION_MODEL_ID];
  if (!config) throw new Error(`Unknown mission model: ${ACTIVE_MISSION_MODEL_ID}`);
  return config;
}

// ── 그룹별 조회(Vertex 전환 스위치) ───────────────────────────
// 그룹A=리포트·요약 / 그룹B=미션 대화 / 그룹C=라이브 음성.
export type ProviderId = "vertex";
export type ModelGroup = "A" | "B" | "C";

export interface GroupModelConfig {
  group: ModelGroup;
  provider: ProviderId;
  modelId: string;
  apiBase: string;
  maxOutputTokens?: number;
  /** 호출부가 이 이름으로 process.env를 조회한다. */
  apiKeyEnv: string;
}

/** provider_switch_settings 미조회/미설정 시 안전하게 쓰는 기본값(Vertex 고정). */
function getStaticModelForGroup(group: ModelGroup): GroupModelConfig {
  return {
    group,
    provider: "vertex",
    modelId: "gemini-2.5-flash",
    apiBase: "https://generativelanguage.googleapis.com",
    apiKeyEnv: "GCP_VERTEX_SA_KEY_JSON",
  };
}

// request-scoped에 가까운 짧은 TTL 메모 — 매 호출 DB 왕복 없이도 스위치 변경이 수 초 내 반영됨.
// (Vercel 서버리스 인스턴스가 재활용되는 동안에만 유효 — 인스턴스마다 독립 캐시라 안전)
const SWITCH_TTL_MS = 10_000;
const switchCache = new Map<ModelGroup, { config: GroupModelConfig; expiresAt: number }>();

/** 그룹(A/B/C)의 현재 provider+model을 DB(provider_switch_settings)에서 조회.
 *  조회 실패/미설정 시 기존 ACTIVE_* 기반 AI Studio 설정으로 안전하게 폴백한다. */
export async function getModelForGroup(group: ModelGroup): Promise<GroupModelConfig> {
  const cached = switchCache.get(group);
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  const fallback = getStaticModelForGroup(group);
  try {
    const service = createServiceClient();
    const { data } = await service
      .from("provider_switch_settings")
      .select("provider, model_id")
      .eq("group", group)
      .maybeSingle();

    const provider = ((data as { provider?: string } | null)?.provider as ProviderId) ?? fallback.provider;
    
    if (provider !== "vertex") {
      throw new Error(`Unsupported provider from DB: ${provider}. Only vertex is allowed.`);
    }
    
    const modelId = (data as { model_id?: string } | null)?.model_id ?? fallback.modelId;

    const config: GroupModelConfig = {
      group,
      provider,
      modelId,
      apiBase: fallback.apiBase,
      maxOutputTokens: fallback.maxOutputTokens,
      apiKeyEnv: "GCP_VERTEX_SA_KEY_JSON",
    };
    switchCache.set(group, { config, expiresAt: Date.now() + SWITCH_TTL_MS });
    return config;
  } catch {
    // provider_switch_settings 조회 실패(테이블 미실행 등) — 안전하게 기존 동작 유지
    return fallback;
  }
}

/** GroupModelConfig에 맞는 GoogleGenAI 클라이언트를 생성(provider별 자격증명 분기).
 *  Vertex: GCP_VERTEX_SA_KEY_JSON 서비스 계정 키(GCP_BILLING_SA_KEY_JSON과 완전 분리) +
 *  GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION(Google Gen AI SDK 표준 환경변수명). AI Studio: GEMMA_API_KEY. */
export function createGenAIClient(config: Pick<GroupModelConfig, "provider" | "apiKeyEnv">): GoogleGenAI {
  if (config.provider !== "vertex") {
    throw new Error("Unsupported provider: only vertex is allowed");
  }
  
  const keyJson = process.env.GCP_VERTEX_SA_KEY_JSON;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!keyJson) throw new Error("GCP_VERTEX_SA_KEY_JSON not configured");
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not configured");
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  const credentials = JSON.parse(keyJson);
  return new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { credentials } });
}
