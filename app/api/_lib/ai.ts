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
import { getActiveGcaiProfile, getGcaiEnvKeys } from "./gcaiProfiles";

// 리포트(요약) 모델 등록부는 app/api/_lib/reportModel.ts로 이동했다(Deno Edge Function도
// 그 파일을 그대로 import해야 해서, 외부 import가 없는 순수 TS로 분리해둔 것). 기존 호출부
// 하위 호환을 위해 여기서 재수출한다.
export { type ReportModelConfig, REPORT_MODELS, ACTIVE_REPORT_MODEL_ID, getActiveReportModel };

// ── 현재 활성 모델 (여기만 바꾸면 전체 적용) ─────────────────
// Vertex Live 릴레이(Cloud Run, services/vertex-live-relay) 전용 모델 ID.
// AI Studio Live와 인증/연결 방식이 완전히 달라(서버 릴레이 필요) /api/voice/token이 
// provider="vertex"일 때 이 값을 그대로 반환한다.
export const VERTEX_LIVE_VOICE_MODEL_ID = "gemini-live-2.5-flash-native-audio";

// ── 그룹별 조회(Vertex 전환 스위치) ───────────────────────────
// 그룹A=리포트·요약 / 그룹B=미션 대화 / 그룹C=라이브 음성.
export type ProviderId = "vertex";
export type ModelGroup = "A" | "B" | "C";

export interface GroupModelConfig {
  group: ModelGroup;
  provider: ProviderId;
  modelId: string;
  maxOutputTokens?: number;
}

/** provider_switch_settings 미조회/미설정 시 안전하게 쓰는 기본값(Vertex 고정). */
function getStaticModelForGroup(group: ModelGroup): GroupModelConfig {
  return {
    group,
    provider: "vertex",
    modelId: "gemini-2.5-flash",
  };
}

// request-scoped에 가까운 짧은 TTL 메모 — 매 호출 DB 왕복 없이도 스위치 변경이 수 초 내 반영됨.
// (Vercel 서버리스 인스턴스가 재활용되는 동안에만 유효 — 인스턴스마다 독립 캐시라 안전)
const SWITCH_TTL_MS = 10_000;
const switchCache = new Map<ModelGroup, { config: GroupModelConfig; expiresAt: number }>();

/** 그룹(A/B/C)의 현재 provider+model을 DB(provider_switch_settings)에서 조회.
 *  조회 실패/미설정 시 안전하게 기본값으로 폴백한다. */
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
      maxOutputTokens: fallback.maxOutputTokens,
    };
    switchCache.set(group, { config, expiresAt: Date.now() + SWITCH_TTL_MS });
    return config;
  } catch {
    // provider_switch_settings 조회 실패(테이블 미실행 등) — 안전하게 기존 동작 유지
    return fallback;
  }
}

/** GroupModelConfig에 맞는 GoogleGenAI 클라이언트를 생성(provider별 자격증명 분기).
 *  Vertex: GCAI 프로필(A/B)에 따라 동적으로 할당된 환경변수 키를 사용하여 
 *  서비스 계정 키 + 프로젝트 + 로케이션을 주입한다. */
export function createGenAIClient(config: Pick<GroupModelConfig, "provider">): GoogleGenAI {
  if (config.provider !== "vertex") {
    throw new Error("Unsupported provider: only vertex is allowed");
  }
  
  const profile = getActiveGcaiProfile();
  const envKeys = getGcaiEnvKeys(profile);

  const keyJson = process.env[envKeys.GCP_VERTEX_SA_KEY_JSON];
  const project = process.env[envKeys.GOOGLE_CLOUD_PROJECT];
  
  if (!keyJson) throw new Error(`[GCAI Profile ${profile}] ${envKeys.GCP_VERTEX_SA_KEY_JSON} not configured`);
  if (!project) throw new Error(`[GCAI Profile ${profile}] ${envKeys.GOOGLE_CLOUD_PROJECT} not configured`);
  
  const location = process.env[envKeys.GOOGLE_CLOUD_LOCATION] || "us-central1";
  const credentials = JSON.parse(keyJson);
  
  return new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { credentials } });
}
