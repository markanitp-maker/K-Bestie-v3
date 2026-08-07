import { LLM_ENV_KEYS, getLlmModel, type LlmModelRole } from "@/lib/llm/modelRouter";
import { getAiRuntimeMetadata, type AiRuntimeKind } from "@/lib/admin/aiRuntimeRegistry";

export type StatusType = "정상" | "경고" | "오류";

export interface LlmStatusEntry {
  id: string;
  name: string;
  category: string;
  runtime: string;
  sdk: string;
  internalPaths: string[];
  envKeys: string[];
  effectiveModel: string;
  fallbackModel: string | null;
  endpointLocation: string;
  /** 구버전 클라이언트 호환용. 신규 UI는 endpointLocation을 사용한다. */
  region: string;
  status: StatusType;
  statusReason?: string;
  warningReason?: string;
}

type FeatureDefinition = {
  id: string;
  name: string;
  category: string;
  sdk: string;
  paths: string[];
  runtimeKind: AiRuntimeKind;
  role?: LlmModelRole;
  fixedModel?: string;
  fixedEnvKeys?: string[];
  fallbackRole?: LlmModelRole;
  credentialEnvKey?: string;
};

const DEFINITIONS: readonly FeatureDefinition[] = [
  { id: "mission_lean", name: "Mode E Lean 미션", category: "텍스트 LLM", sdk: "@google/genai", paths: ["app/api/mission/respond-lean/route.ts"], role: "missionLean", fallbackRole: "missionLeanFallback", runtimeKind: "vercelVertex" },
  { id: "mission_reaction", name: "Mode E Reaction", category: "텍스트 LLM", sdk: "@google/genai", paths: ["app/api/mission/reaction-lean/route.ts"], role: "missionReaction", fallbackRole: "missionReactionFallback", runtimeKind: "vercelVertex" },
  { id: "mission_general", name: "일반 미션 대화", category: "텍스트 LLM", sdk: "@google/genai", paths: ["app/api/mission/respond/route.ts"], role: "missionGeneral", runtimeKind: "vercelVertex" },
  { id: "mission_memory_greeting", name: "미션 기억 안부 인사", category: "텍스트 LLM", sdk: "@google/genai", paths: ["lib/mission/memoryGreeting.ts"], role: "missionMemoryGreeting", runtimeKind: "vercelVertex" },
  { id: "freechat_memory", name: "자유대화 기억 연계", category: "텍스트 LLM", sdk: "@google/genai", paths: ["lib/freechat/memoryRecallResponder.ts"], role: "freechatMemoryRecall", runtimeKind: "vercelVertex" },
  { id: "parent_memory_query", name: "부모 기억 조회", category: "텍스트 LLM", sdk: "@google/genai", paths: ["app/api/parent/memory/query/route.ts"], role: "parentMemoryQuery", runtimeKind: "vercelVertex" },
  { id: "child_answer_class", name: "아이 답변 분류", category: "텍스트 LLM", sdk: "@google/genai", paths: ["lib/questions/answer-classifier.ts"], role: "childAnswerClassification", runtimeKind: "vercelVertex" },
  { id: "parent_k_chat", name: "부모-K 대화", category: "텍스트 LLM", sdk: "@google/genai", paths: ["app/api/parent/k-chat/route.ts"], role: "parentKChat", runtimeKind: "vercelVertex" },
  { id: "parent_question_gen", name: "부모 질문 생성", category: "텍스트 LLM", sdk: "@google/genai", paths: ["app/api/parent/questions/route.ts"], role: "parentQuestionGeneration", runtimeKind: "vercelVertex" },
  { id: "context_correction", name: "Context Correction", category: "Batch", sdk: "@google/genai", paths: ["lib/batch/contextCorrectionV3.ts"], role: "contextCorrection", runtimeKind: "vercelVertex" },
  { id: "daily_report", name: "일일 리포트", category: "Batch", sdk: "@google/genai", paths: ["lib/batch/dailyReportV3.ts"], role: "dailyReport", runtimeKind: "vercelVertex" },
  { id: "weekly_report", name: "주간 리포트", category: "Batch", sdk: "@google/genai", paths: ["lib/batch/generateWeeklySummary.ts"], role: "weeklyReport", runtimeKind: "vercelVertex" },
  { id: "supabase_batch_report", name: "Supabase Batch 리포트", category: "Batch", sdk: "npm:@google/genai", paths: ["supabase/functions/_shared/batch.ts"], role: "supabaseBatchReport", runtimeKind: "supabaseVertex" },
  { id: "vacation_event_detection", name: "방학/개학 이벤트 감지", category: "이벤트 감지", sdk: "@google/genai", paths: ["lib/plan/vacationEventDetector.ts"], role: "vacationEventDetection", runtimeKind: "vercelVertex" },
  { id: "premium_live_voice", name: "Premium 실시간 음성 (Live)", category: "Live 음성", sdk: "@google/genai", paths: ["services/vertex-live-relay/src/server.ts"], fixedModel: "gemini-live-2.5-flash-native-audio", fixedEnvKeys: [], runtimeKind: "cloudRunVertex" },
  { id: "gcp_stt", name: "아동 음성 전사 (STT)", category: "STT", sdk: "GCP Speech REST", paths: ["app/api/mission/stt/route.ts"], fixedModel: "default", fixedEnvKeys: ["GCP_STT_API_KEY"], runtimeKind: "globalRest", credentialEnvKey: "GCP_STT_API_KEY" },
  { id: "gcp_tts", name: "케이 음성 합성 (TTS)", category: "TTS", sdk: "GCP TTS REST", paths: ["app/api/voice/tts/route.ts"], fixedModel: "ko-KR-Wavenet-A", fixedEnvKeys: ["GCP_TTS_API_KEY"], runtimeKind: "globalRest", credentialEnvKey: "GCP_TTS_API_KEY" },
  { id: "embedding", name: "LLM Wiki 벡터 검색", category: "Embedding", sdk: "@google/genai + npm:@google/genai", paths: ["lib/memory/vectorRetrieval.ts", "supabase/functions/_shared/batch.ts"], fixedModel: "gemini-embedding-001", fixedEnvKeys: [], runtimeKind: "embeddingDual" },
] as const;

function unique(values: string[]) {
  return [...new Set(values)];
}

function validModelId(model: string) {
  const value = model.trim();
  return value.length >= 5 && !value.includes("://");
}

function buildEntry(definition: FeatureDefinition): LlmStatusEntry {
  const effectiveModel = definition.fixedModel ?? getLlmModel(definition.role!);
  const modelEnvKeys = definition.fixedEnvKeys
    ?? [LLM_ENV_KEYS[definition.role!], ...(definition.fallbackRole ? [LLM_ENV_KEYS[definition.fallbackRole]] : [])];
  const fallbackModel = definition.fallbackRole ? getLlmModel(definition.fallbackRole) : null;
  const runtime = getAiRuntimeMetadata(definition.runtimeKind);
  const problems = [...runtime.problems];
  const warnings = [...runtime.warnings];

  if (!validModelId(effectiveModel)) problems.push("실제 적용 모델 ID가 유효하지 않습니다.");
  if (fallbackModel !== null && !validModelId(fallbackModel)) problems.push("Fallback 모델 ID가 유효하지 않습니다.");
  if (definition.credentialEnvKey && !process.env[definition.credentialEnvKey]?.trim()) {
    problems.push(`${definition.credentialEnvKey}가 설정되지 않았습니다.`);
  }

  const status: StatusType = problems.length > 0 ? "오류" : warnings.length > 0 ? "경고" : "정상";
  const reason = [...problems, ...warnings].join(" ") || undefined;
  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    runtime: runtime.runtime,
    sdk: definition.sdk,
    internalPaths: [...definition.paths],
    envKeys: unique([...modelEnvKeys, ...runtime.credentialEnvKeys, ...runtime.locationEnvKeys]),
    effectiveModel,
    fallbackModel,
    endpointLocation: runtime.endpointLocation,
    region: runtime.endpointLocation,
    status,
    statusReason: reason,
    warningReason: reason,
  };
}

export function getLlmStatusList(): LlmStatusEntry[] {
  return DEFINITIONS.map(buildEntry);
}

export const AI_RUNTIME_CODE_PATHS = DEFINITIONS.flatMap((definition) => definition.paths);
