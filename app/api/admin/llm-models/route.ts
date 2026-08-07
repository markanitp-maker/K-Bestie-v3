import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/requireAdmin';
import { LLM_MODEL_ROLES, LLM_ENV_KEYS, getLlmModel, type LlmModelRole } from '@/lib/llm/modelRouter';

export const dynamic = 'force-dynamic';

const ROLE_DESCRIPTIONS: Record<LlmModelRole, string> = {
  premiumLiveVoice: "Premium 실시간 음성 대화",
  missionLean: "미션 Lean 응답",
  missionLeanFallback: "미션 Lean 응답 (폴백)",
  missionReaction: "미션 짧은 반응 Reaction",
  missionReactionFallback: "미션 짧은 반응 Reaction (폴백)",
  missionMemoryGreeting: "미션 시작 메모리 인사",
  freechatMemoryRecall: "자유대화 메모리 회상 응답",
  parentMemoryQuery: "부모의 LLM WIKI·아이 메모리 질의",
  missionGeneral: "일반 미션 응답·답변 분석",
  childAnswerClassification: "아이 답변 유효성·안전성·유형 분류",
  parentKChat: "부모-K 대화",
  parentQuestionGeneration: "부모용 질문 생성·변환",
  contextCorrection: "대화 문맥 보정",
  dailyReport: "일일 리포트 생성",
  weeklyReport: "주간 리포트 생성",
  supabaseBatchReport: "Supabase 배치 리포트 처리",
  adminTextHealth: "관리자 텍스트 LLM 헬스체크",
  adminLiveHealth: "관리자 실시간 음성 헬스체크",
  vacationEventDetection: "방학/개학 이벤트 감지",
  embedding: "LLM Wiki 벡터 검색",
};

export async function GET() {
  const authResponse = await requireAdmin();
  if (authResponse) return authResponse;

  const models = Object.entries(LLM_MODEL_ROLES).map(([roleKey, defaultModel]) => {
    const role = roleKey as LlmModelRole;
    const envKey = LLM_ENV_KEYS[role];
    const envValue = process.env[envKey] || null;
    const effectiveModel = getLlmModel(role);
    
    return {
      role,
      description: ROLE_DESCRIPTIONS[role],
      defaultModel,
      envKey,
      envValue,
      effectiveModel,
      isOverridden: !!envValue && envValue.trim() !== ""
    };
  });

  return NextResponse.json({ models });
}
