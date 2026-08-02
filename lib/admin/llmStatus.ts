import { LLM_MODEL_ROLES, LLM_ENV_KEYS, getLlmModel, type LlmModelRole } from "@/lib/llm/modelRouter";

export type FeatureType = "텍스트 생성" | "음성(Live)" | "STT/TTS" | "Batch/Report" | "기타";
export type PlatformType = "Vercel Node" | "Supabase Edge" | "Cloud Run" | "기타";
export type StatusType = "정상" | "미설정" | "설정 불일치" | "확인 불가" | "기본값 사용";

export interface LlmStatusEntry {
  id: string;
  name: string;
  featureType: FeatureType;
  platform: PlatformType;
  internalPath: string;
  envKey: string | null;
  defaultModel: string | null;
  effectiveModel: string | null;
  fallbackModel: string | null;
  region: string;
  status: StatusType;
  warningReason?: string;
  apiMethod: string;
}

export function getLlmStatusList(): LlmStatusEntry[] {
  const entries: LlmStatusEntry[] = [];
  
  // Helper to build a standard entry using modelRouter
  const buildEntry = (
    id: string,
    name: string,
    featureType: FeatureType,
    platform: PlatformType,
    internalPath: string,
    role: LlmModelRole,
    fallbackRole?: LlmModelRole
  ): LlmStatusEntry => {
    const defaultModel = LLM_MODEL_ROLES[role];
    const envKey = LLM_ENV_KEYS[role];
    const effectiveModel = getLlmModel(role);
    const isOverride = effectiveModel !== defaultModel;
    const fallbackModel = fallbackRole ? getLlmModel(fallbackRole) : null;
    
    let status: StatusType = isOverride ? "정상" : "기본값 사용";
    let warningReason = undefined;
    
    if (!effectiveModel || effectiveModel.trim() === "") {
      status = "미설정";
      warningReason = "모델 값이 비어있습니다.";
    }

    return {
      id,
      name,
      featureType,
      platform,
      internalPath,
      envKey,
      defaultModel,
      effectiveModel,
      fallbackModel,
      region: process.env.GOOGLE_CLOUD_LOCATION || "확인 불가",
      status,
      warningReason,
      apiMethod: "Vertex AI SDK (@google/genai)",
    };
  };

  entries.push(buildEntry("mission_lean", "Mode E (Lean) 미션 텍스트", "텍스트 생성", "Vercel Node", "app/api/mission/respond-lean/route.ts", "missionLean", "missionLeanFallback"));
  entries.push(buildEntry("mission_reaction", "Mode E 리액션", "텍스트 생성", "Vercel Node", "app/api/mission/reaction-lean/route.ts", "missionReaction", "missionReactionFallback"));
  entries.push(buildEntry("mission_general", "미션 일반 대화 (A/B)", "텍스트 생성", "Vercel Node", "app/api/mission/respond/route.ts", "missionGeneral"));
  entries.push(buildEntry("premium_live_voice", "프리미엄 라이브 음성 (C)", "음성(Live)", "Cloud Run", "app/api/voice/token/route.ts", "premiumLiveVoice"));
  entries.push(buildEntry("freechat_memory", "자유대화 기억 연계", "텍스트 생성", "Vercel Node", "lib/freechat/memoryRecallResponder.ts", "freechatMemoryRecall"));
  entries.push(buildEntry("parent_memory_query", "부모 기억 조회", "텍스트 생성", "Vercel Node", "app/api/parent/memory/query/route.ts", "parentMemoryQuery"));
  entries.push(buildEntry("child_answer_class", "아이 답변 분류", "텍스트 생성", "Vercel Node", "lib/questions/answer-classifier.ts", "childAnswerClassification"));
  entries.push(buildEntry("parent_k_chat", "부모-케이 대화", "텍스트 생성", "Vercel Node", "app/api/parent/k-chat/route.ts", "parentKChat"));
  entries.push(buildEntry("parent_question_gen", "부모 질문 생성", "텍스트 생성", "Vercel Node", "app/api/parent/questions/route.ts", "parentQuestionGeneration"));
  entries.push(buildEntry("context_correction", "Context Correction V3", "Batch/Report", "Vercel Node", "lib/batch/contextCorrectionV3.ts", "contextCorrection"));
  entries.push(buildEntry("daily_report", "일일 리포트", "Batch/Report", "Vercel Node", "lib/batch/dailyReportV3.ts", "dailyReport"));
  entries.push(buildEntry("weekly_report", "주간 리포트", "Batch/Report", "Vercel Node", "lib/batch/generateWeeklySummary.ts", "weeklyReport"));
  entries.push(buildEntry("supabase_batch_report", "Edge Function 배치 리포트", "Batch/Report", "Supabase Edge", "supabase/functions/_shared/batch.ts", "supabaseBatchReport"));
  entries.push(buildEntry("mission_memory_greeting", "미션 기억 안부 인사", "텍스트 생성", "Vercel Node", "lib/mission/memoryGreeting.ts", "missionMemoryGreeting"));

  // Extra Vertex Live relay entry (Cloud run)
  entries.push({
    id: "vertex_live_relay",
    name: "Vertex Live 릴레이 서비스",
    featureType: "음성(Live)",
    platform: "Cloud Run",
    internalPath: "services/vertex-live-relay",
    envKey: "자체 환경변수 사용",
    defaultModel: "확인 불가",
    effectiveModel: "확인 불가",
    fallbackModel: null,
    region: "확인 불가",
    status: "확인 불가",
    warningReason: "별도 Cloud Run 서비스로 배포되어 확인 불가",
    apiMethod: "Vertex AI Live API (WebSockets)",
  });
  
  // STT / TTS (Google Cloud Speech APIs)
  entries.push({
    id: "gcp_stt",
    name: "GCP STT (Speech-to-Text)",
    featureType: "STT/TTS",
    platform: "Vercel Node",
    internalPath: "app/api/stt/route.ts (추정)",
    envKey: "GCP_VERTEX_SA_KEY_JSON",
    defaultModel: "latest_long",
    effectiveModel: "latest_long",
    fallbackModel: null,
    region: process.env.GOOGLE_CLOUD_LOCATION || "확인 불가",
    status: process.env.GCP_VERTEX_SA_KEY_JSON ? "정상" : "미설정",
    warningReason: !process.env.GCP_VERTEX_SA_KEY_JSON ? "GCP 서비스 계정 키 없음" : undefined,
    apiMethod: "GCP REST API",
  });
  entries.push({
    id: "gcp_tts",
    name: "GCP TTS (Text-to-Speech)",
    featureType: "STT/TTS",
    platform: "Vercel Node",
    internalPath: "app/api/tts/route.ts (추정)",
    envKey: "GCP_VERTEX_SA_KEY_JSON",
    defaultModel: "ko-KR-Journey-F",
    effectiveModel: "ko-KR-Journey-F",
    fallbackModel: null,
    region: process.env.GOOGLE_CLOUD_LOCATION || "확인 불가",
    status: process.env.GCP_VERTEX_SA_KEY_JSON ? "정상" : "미설정",
    warningReason: !process.env.GCP_VERTEX_SA_KEY_JSON ? "GCP 서비스 계정 키 없음" : undefined,
    apiMethod: "GCP REST API",
  });

  return entries;
}
