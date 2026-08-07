/**
 * AI 모델 스위치 레이어
 * 모델 교체 시 이 파일의 ACTIVE_* 상수만 변경 — 호출 코드 불변
 */

import { GoogleGenAI } from "@google/genai";
import {
  type ReportModelConfig,
  REPORT_MODELS,
  getActiveReportModel,
  getReportModel,
} from "./reportModel";
import { getActiveGcaiProfile, getGcaiEnvKeys } from "./gcaiProfiles";
import { getLlmModel, type LlmModelRole } from "@/lib/llm/modelRouter";

export type ProviderId = "vertex";
export type ModelGroup = "A" | "B" | "C";
export interface GroupModelConfig {
  provider: ProviderId;
  modelId: string;
  group?: ModelGroup;
  maxOutputTokens?: number;
}

function roleForGroup(group: ModelGroup): LlmModelRole {
  if (group === "A") return "dailyReport";
  if (group === "C") return "premiumLiveVoice";
  return "missionGeneral";
}

export async function getModelForGroup(group: ModelGroup): Promise<GroupModelConfig> {
  return {
    group,
    provider: "vertex",
    modelId: getLlmModel(roleForGroup(group)),
  };
}
// 하위 호환을 위해 여기서 재수출한다.
export { type ReportModelConfig, REPORT_MODELS, getActiveReportModel, getReportModel };

// ── 현재 활성 모델 (여기만 바꾸면 전체 적용) ─────────────────
// Vertex Live 릴레이(Cloud Run, services/vertex-live-relay) 전용 모델 ID.
// AI Studio Live와 인증/연결 방식이 완전히 달라(서버 릴레이 필요) /api/voice/token이 
// provider="vertex"일 때 이 값을 그대로 반환한다.
export const VERTEX_LIVE_VOICE_MODEL_ID = getLlmModel("premiumLiveVoice");

// Mode E lean 전용 STT+LLM 텍스트 채팅 미션 모델 및 maxOutputTokens
export const LEAN_E_MODEL_ID = getLlmModel("missionLean");
export const LEAN_E_MAX_OUTPUT_TOKENS = 40;
export const REACTION_LEAN_MAX_OUTPUT_TOKENS = 40;

// 자유대화 전용 텍스트 응답 모델. 미션 그룹 B 및 Live 음성 모델과 독립적으로 고정한다.
export const FREE_CHAT_MODEL_ID = getLlmModel("freechatMemoryRecall");
export const FREE_CHAT_MAX_OUTPUT_TOKENS = 80;



/** GoogleGenAI 클라이언트를 생성(provider별 자격증명 분기).
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
  
  const location = process.env[envKeys.GOOGLE_CLOUD_LOCATION] || "global";
  const credentials = JSON.parse(keyJson);
  
  return new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { credentials } });
}
