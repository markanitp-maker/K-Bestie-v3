export const LLM_MODEL_ROLES = {
  premiumLiveVoice: "gemini-live-2.5-flash-native-audio",
  missionLean: "gemini-3.5-flash-lite",
  missionLeanFallback: "gemini-3.5-flash",
  missionReaction: "gemini-3.5-flash-lite",
  missionReactionFallback: "gemini-3.5-flash",
  missionMemoryGreeting: "gemini-3.5-flash-lite",
  freechatMemoryRecall: "gemini-3.5-flash-lite",
  parentMemoryQuery: "gemini-3.5-flash-lite",
  missionGeneral: "gemini-3.5-flash",
  // 요청서 020 §3-2 — missionGeneral 이 429/timeout/5xx 로 실패했을 때 정확히 1회만
  // 부르는 대체 모델. 같은 모델을 다시 부르면 한도를 더 밀어붙일 뿐이라 더 가벼운
  // 모델로 갈아탄다. 이 저장소가 이미 쓰는 모델만 쓴다(신규 모델 추측 금지).
  missionGeneralFallback: "gemini-3.5-flash-lite",
  childAnswerClassification: "gemini-3.5-flash",
  parentKChat: "gemini-3.5-flash-lite",
  parentQuestionGeneration: "gemini-3.5-flash",
  contextCorrection: "gemini-3.5-flash",
  dailyReport: "gemini-3.6-flash",
  weeklyReport: "gemini-3.6-flash",
  supabaseBatchReport: "gemini-3.5-flash",
  adminTextHealth: "gemini-3.5-flash",
  adminLiveHealth: "gemini-live-2.5-flash-native-audio",
  vacationEventDetection: "gemini-3.5-flash",
  // 요청서 012 — 관계 안전 의미 판정(Shadow). 분류만 하므로 이 저장소에서 이미 쓰는
  // 가장 가벼운 모델을 쓴다(신규 모델을 추측해 넣지 않는다).
  relationshipSafetyJudge: "gemini-3.5-flash-lite",
  // 끝말잇기 낱말 판정 — "이게 한국어 낱말인가" 한 가지만 본다. 짧고 잦으므로 lite.
  wordChainWordJudge: "gemini-3.5-flash-lite",
} as const;

export type LlmModelRole = keyof typeof LLM_MODEL_ROLES;

export const LLM_ENV_KEYS: Record<LlmModelRole, string> = {
  premiumLiveVoice: "LLM_MODEL_PREMIUM_LIVE_VOICE",
  missionLean: "LLM_MODEL_MISSION_LEAN",
  missionLeanFallback: "LLM_MODEL_MISSION_LEAN_FALLBACK",
  missionReaction: "LLM_MODEL_MISSION_REACTION",
  missionReactionFallback: "LLM_MODEL_MISSION_REACTION_FALLBACK",
  missionMemoryGreeting: "LLM_MODEL_MISSION_MEMORY_GREETING",
  freechatMemoryRecall: "LLM_MODEL_FREECHAT_MEMORY_RECALL",
  parentMemoryQuery: "LLM_MODEL_PARENT_MEMORY_QUERY",
  missionGeneral: "LLM_MODEL_MISSION_GENERAL",
  missionGeneralFallback: "LLM_MODEL_MISSION_GENERAL_FALLBACK",
  childAnswerClassification: "LLM_MODEL_CHILD_CLASSIFICATION",
  parentKChat: "LLM_MODEL_PARENT_K_CHAT",
  parentQuestionGeneration: "LLM_MODEL_PARENT_QUESTION_GENERATION",
  contextCorrection: "LLM_MODEL_CONTEXT_CORRECTION",
  dailyReport: "LLM_MODEL_DAILY_REPORT",
  weeklyReport: "LLM_MODEL_WEEKLY_REPORT",
  supabaseBatchReport: "LLM_MODEL_BATCH_REPORT",
  adminTextHealth: "LLM_MODEL_ADMIN_TEXT_HEALTH",
  adminLiveHealth: "LLM_MODEL_ADMIN_LIVE_HEALTH",
  vacationEventDetection: "LLM_MODEL_VACATION_EVENT_DETECTION",
  relationshipSafetyJudge: "LLM_MODEL_RELATIONSHIP_SAFETY_JUDGE",
  wordChainWordJudge: "LLM_MODEL_WORD_CHAIN_WORD_JUDGE",
};

/**
 * 런타임 환경(Node.js 또는 Deno)에 맞게 환경변수를 가져온다.
 */
function getEnvValue(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  // @ts-ignore
  if (typeof Deno !== "undefined" && Deno.env) {
    // @ts-ignore
    return Deno.env.get(key);
  }
  return undefined;
}

/**
 * 기능 역할에 맞는 LLM 모델 ID를 반환한다.
 * 환경변수가 지정되어 있으면 우선 사용하고, 없으면 확정된 기본 모델을 반환한다.
 */
export function getLlmModel(role: LlmModelRole): string {
  const envKey = LLM_ENV_KEYS[role];
  const envValue = getEnvValue(envKey);
  
  if (envValue && envValue.trim() !== "") {
    return envValue.trim();
  }
  
  return LLM_MODEL_ROLES[role];
}

/**
 * 앱 시작 시 유효하지 않은 모델 매핑이 있는지 검증한다.
 * 빈 값으로 설정되었거나 잘못된 문자열을 설정한 경우 경고를 남긴다.
 */
export function validateModelRouterConfiguration(): void {
  const overrides = Object.entries(LLM_ENV_KEYS).filter(([role, key]) => {
    const val = getEnvValue(key);
    return val && val.trim() !== "";
  });
  
  if (overrides.length > 0) {
    for (const [, key] of overrides) {
      const val = getEnvValue(key)?.trim() || "";
      // 간단한 유효성 검증: HTTP URL이 들어오거나 모델 명명규칙에 안맞게 너무 짧은 경우 등
      if (val.includes("http://") || val.includes("https://") || val.length < 5) {
        console.warn(`[ModelRouter] Warning: Invalid model ID in ${key}: ${val}. This may cause errors.`);
      }
    }
  }
}

// 모듈 로드 시 바로 검증 실행
validateModelRouterConfiguration();
