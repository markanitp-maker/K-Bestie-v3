import { LLM_ENV_KEYS, getLlmModel, getLlmRegion, type LlmModelRole } from "@/lib/llm/modelRouter";

export type StatusType = "정상" | "오류";

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
  region: string;
  status: StatusType;
  warningReason?: string;
}

type VertexDefinition = {
  id: string;
  name: string;
  category: string;
  runtime: string;
  sdk: string;
  paths: string[];
  role?: LlmModelRole;
  fixedModel?: string;
  fixedEnvKeys?: string[];
  fallbackRole?: LlmModelRole;
  region: "vertex" | "global";
  credentialEnvKey?: string;
};

const DEFINITIONS: readonly VertexDefinition[] = [
  { id: "mission_lean", name: "Mode E Lean 미션", category: "텍스트 LLM", runtime: "Vercel Node", sdk: "@google/genai", paths: ["app/api/mission/respond-lean/route.ts"], role: "missionLean", fallbackRole: "missionLeanFallback", region: "vertex" },
  { id: "mission_reaction", name: "Mode E Reaction", category: "텍스트 LLM", runtime: "Vercel Node", sdk: "@google/genai", paths: ["app/api/mission/reaction-lean/route.ts"], role: "missionReaction", fallbackRole: "missionReactionFallback", region: "vertex" },
  { id: "mission_general", name: "일반 미션 대화", category: "텍스트 LLM", runtime: "Vercel Node", sdk: "@google/genai", paths: ["app/api/mission/respond/route.ts"], role: "missionGeneral", region: "vertex" },
  { id: "mission_memory_greeting", name: "미션 기억 안부 인사", category: "텍스트 LLM", runtime: "Vercel Node", sdk: "@google/genai", paths: ["lib/mission/memoryGreeting.ts"], role: "missionMemoryGreeting", region: "vertex" },
  { id: "freechat_memory", name: "자유대화 기억 연계", category: "텍스트 LLM", runtime: "Vercel Node", sdk: "@google/genai", paths: ["lib/freechat/memoryRecallResponder.ts"], role: "freechatMemoryRecall", region: "vertex" },
  { id: "parent_memory_query", name: "부모 기억 조회", category: "텍스트 LLM", runtime: "Vercel Node", sdk: "@google/genai", paths: ["app/api/parent/memory/query/route.ts"], role: "parentMemoryQuery", region: "vertex" },
  { id: "child_answer_class", name: "아이 답변 분류", category: "텍스트 LLM", runtime: "Vercel Node", sdk: "@google/genai", paths: ["lib/questions/answer-classifier.ts"], role: "childAnswerClassification", region: "vertex" },
  { id: "parent_k_chat", name: "부모-K 대화", category: "텍스트 LLM", runtime: "Vercel Node", sdk: "@google/genai", paths: ["app/api/parent/k-chat/route.ts"], role: "parentKChat", region: "vertex" },
  { id: "parent_question_gen", name: "부모 질문 생성", category: "텍스트 LLM", runtime: "Vercel Node", sdk: "@google/genai", paths: ["app/api/parent/questions/route.ts"], role: "parentQuestionGeneration", region: "vertex" },
  { id: "context_correction", name: "Context Correction", category: "Batch", runtime: "Vercel Node", sdk: "@google/genai", paths: ["lib/batch/contextCorrectionV3.ts"], role: "contextCorrection", region: "vertex" },
  { id: "daily_report", name: "일일 리포트", category: "Batch", runtime: "Vercel Node", sdk: "@google/genai", paths: ["lib/batch/dailyReportV3.ts"], role: "dailyReport", region: "vertex" },
  { id: "weekly_report", name: "주간 리포트", category: "Batch", runtime: "Vercel Node", sdk: "@google/genai", paths: ["lib/batch/generateWeeklySummary.ts"], role: "weeklyReport", region: "vertex" },
  { id: "supabase_batch_report", name: "Supabase Batch 리포트", category: "Batch", runtime: "Supabase Edge / Deno", sdk: "npm:@google/genai", paths: ["supabase/functions/_shared/batch.ts"], role: "supabaseBatchReport", region: "vertex" },
  { id: "vacation_event_detection", name: "방학/개학 이벤트 감지", category: "이벤트 감지", runtime: "Vercel Node", sdk: "@google/genai", paths: ["lib/plan/vacationEventDetector.ts"], role: "vacationEventDetection", region: "vertex" },
  { id: "premium_live_voice", name: "Premium 실시간 음성 (Live)", category: "Live 음성", runtime: "Cloud Run", sdk: "@google/genai", paths: ["services/vertex-live-relay/src/server.ts"], role: "premiumLiveVoice", region: "vertex" },
  { id: "gcp_stt", name: "아동 음성 전사 (STT)", category: "STT", runtime: "Vercel Node", sdk: "GCP Speech REST", paths: ["app/api/mission/stt/route.ts"], fixedModel: "default", fixedEnvKeys: ["GCP_STT_API_KEY"], region: "global", credentialEnvKey: "GCP_STT_API_KEY" },
  { id: "gcp_tts", name: "케이 음성 합성 (TTS)", category: "TTS", runtime: "Vercel Node", sdk: "GCP TTS REST", paths: ["app/api/voice/tts/route.ts"], fixedModel: "ko-KR-Wavenet-A", fixedEnvKeys: ["GCP_TTS_API_KEY"], region: "global", credentialEnvKey: "GCP_TTS_API_KEY" },
  { id: "embedding", name: "LLM Wiki 벡터 검색", category: "Embedding", runtime: "Vercel Node + Supabase Edge / Deno", sdk: "@google/genai + npm:@google/genai", paths: ["lib/memory/vectorRetrieval.ts", "supabase/functions/_shared/batch.ts"], role: "embedding", region: "vertex" },
] as const;

function buildEntry(definition: VertexDefinition): LlmStatusEntry {
  const effectiveModel = definition.fixedModel ?? getLlmModel(definition.role!);
  const envKeys = definition.fixedEnvKeys
    ?? [LLM_ENV_KEYS[definition.role!], ...(definition.fallbackRole ? [LLM_ENV_KEYS[definition.fallbackRole]] : [])];
  const fallbackModel = definition.fallbackRole ? getLlmModel(definition.fallbackRole) : null;
  const region = definition.region === "global" ? "Global" : getLlmRegion();
  const problems: string[] = [];

  if (!effectiveModel.trim()) problems.push("실제 적용 모델이 비어 있습니다.");
  if (definition.credentialEnvKey && !process.env[definition.credentialEnvKey]?.trim()) {
    problems.push(`${definition.credentialEnvKey}가 설정되지 않았습니다.`);
  }
  if (definition.region === "vertex" && region !== "us-central1") {
    problems.push(`실제 리전이 us-central1이 아니라 ${region}입니다.`);
  }

  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    runtime: definition.runtime,
    sdk: definition.sdk,
    internalPaths: [...definition.paths],
    envKeys,
    effectiveModel,
    fallbackModel,
    region,
    status: problems.length === 0 ? "정상" : "오류",
    warningReason: problems.length > 0 ? problems.join(" ") : undefined,
  };
}

export function getLlmStatusList(): LlmStatusEntry[] {
  return DEFINITIONS.map(buildEntry);
}

export const AI_RUNTIME_CODE_PATHS = DEFINITIONS.flatMap((definition) => definition.paths);
