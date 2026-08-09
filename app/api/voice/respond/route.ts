import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkConsentForSession } from "@/lib/plan/consentGuard";
import { checkApprovalForSession } from "@/lib/plan/approvalGuard";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { isMemoryRecallQuery } from "@/lib/freechat/memoryRecallTrigger";
import { generateMemoryRecallResponse } from "@/lib/freechat/memoryRecallResponder";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import { after } from "next/server";
import { fetchKPeerPersonaForChild } from "@/lib/persona/kPeerPersona";
import { createGenAIClient, FREE_CHAT_MODEL_ID } from "@/app/api/_lib/ai";
import { getKstBusinessDate } from "@/lib/utils/kstBusinessDate";
import {
  getActiveVacationContext,
  resolveSchoolQuestionBlockState,
  getVacationFollowUpQuestion,
  getSchoolStartConfirmationQuestion,
  markVacationQuestionAsked,
} from "@/lib/plan/vacationSchoolContext";
import { parseGrade } from "@/lib/mission/selectQuestions";
import { respond as respondWithEngine, checkSafetyPreflight, type GenerateArgs } from "@/lib/k-conversation";

export const runtime = "nodejs";

// 071 자유대화 v2 — K Conversation Engine Free Chat Adapter.
// 이 route는 이제 "어떻게 말할지"를 직접 결정하지 않는다(Persona/Memory/Boredom/Action/
// Response 생성은 전부 lib/k-conversation이 담당). 이 route에 남는 책임은:
//   1) 인증/동의/승인 같은 요청 단위 가드
//   2) Safety preflight — 방학·기억회상처럼 Engine 호출 전에 조기 반환하는 모든 경로보다
//      Safety가 먼저 실행되도록 강제한다(codex-rv 지적: 조기 반환 경로가 Safety를 완전히
//      건너뛰는 회귀가 있었다 — 절대 재발 금지).
//   3) Engine 범위 밖의 결정론적 규칙(방학/개학 후속 질문) — Goal이 아니라 순수 규칙이라
//      071 §3의 "Goal 관련 로직만 금지" 경계 밖에 있다
//   4) "기억나?" 전용 하이-그라운딩 응답(memoryRecallResponder) — 071이 흡수하라고
//      명시하지 않은 특수 안전 경로라 그대로 유지한다(계획서 §Phase 0 결정)
//   5) usage_events 과금 로깅, API 응답 포맷 번역
const LOW_ASR_CONFIDENCE_THRESHOLD = 0.55;

interface HistoryTurn { role: "child" | "k"; text: string }

function isValidHistoryTurn(value: unknown): value is HistoryTurn {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (row.role === "child" || row.role === "k") && typeof row.text === "string";
}

function recordLlmUsage(sessionId: string, tokenIn: number, tokenOut: number) {
  after(async () => {
    try {
      const ctx = await resolveUsageContext(sessionId);
      if (!ctx) return;
      const serviceRole = createServiceClient();
      const estCostKrw = estimateCost({ kind: "llm", tokenIn, tokenOut });
      await serviceRole.from("usage_events").insert({
        child_id: ctx.childId,
        tier: ctx.tier,
        voice_mode: ctx.voiceMode,
        kind: "llm",
        token_in: tokenIn,
        token_out: tokenOut,
        est_cost_krw: estCostKrw,
        conversation_mode: null,
      });
    } catch (err) {
      console.error("[voice/respond] usage_events insert failed:", (err as Error).message);
    }
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { history?: unknown; sessionId?: string; asrConfidence?: number; appMode?: string };
  try {
    const parsed: unknown = await req.json();
    // codex-rv 지적: JSON 본문이 null/배열/원시값이면 이후 body.history 접근에서 500이 난다.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // codex-rv 지적: asrConfidence는 0~1 범위 밖 값(음수·1 초과)을 검증 없이 그대로 받았다.
  if (
    body.asrConfidence !== undefined &&
    (typeof body.asrConfidence !== "number" || body.asrConfidence < 0 || body.asrConfidence > 1)
  ) {
    return NextResponse.json({ error: "asrConfidence must be a number between 0 and 1" }, { status: 400 });
  }

  // codex-rv 지적: history 원소를 검증 없이 신뢰하면 숫자형 등 잘못된 text가 .trim()에서
  // 500을 낸다. 형식이 맞는 turn만 통과시킨다.
  const history = Array.isArray(body.history) ? body.history.filter(isValidHistoryTurn) : [];
  if (history.length === 0) {
    return NextResponse.json({ error: "history required" }, { status: 400 });
  }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: session } = await service
    .from("chat_sessions")
    .select("child_id, session_type")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session?.child_id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, session.child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 073 Mission Adapter가 아직 없다 — Goal Layer 없이 이 route가 mission 세션에 쓰이면
  // 안 된다(codex-rv 지적). 미션은 자기 전용 엔드포인트(/api/mission/respond 등)를 쓴다.
  // codex-rv 2차 지적: 소유권 확인(authCheck) 뒤로 옮겨서, 타 사용자가 세션 ID만으로
  // 404/400/403 상태코드 차이를 이용해 세션 존재·유형을 추측할 수 없게 한다.
  if (session.session_type !== "free_chat") {
    return NextResponse.json({ error: "This endpoint only serves free_chat sessions" }, { status: 400 });
  }

  const consentBlocked = await checkConsentForSession(sessionId);
  if (consentBlocked) return consentBlocked;

  const approvalBlocked = await checkApprovalForSession(sessionId);
  if (approvalBlocked) return approvalBlocked;

  const lastChild = [...history].reverse().find((t) => t.role === "child" && t.text?.trim());
  if (!lastChild) {
    return NextResponse.json({ error: "no child utterance in history" }, { status: 400 });
  }
  const childText = lastChild.text.trim();

  // Safety preflight — 이 아래의 모든 조기 반환 경로(방학 규칙/기억회상)보다 반드시 먼저
  // 실행한다. 걸리면 그 무엇보다 우선해 즉시 반환한다.
  const safetyResult = await checkSafetyPreflight(service, sessionId, childText);
  if (safetyResult) {
    return NextResponse.json({
      text: safetyResult.text,
      category: safetyResult.category,
      flaggedForParent: safetyResult.safetyFlagged ?? false,
      model: "rule_engine",
    });
  }

  // 068: 방학/개학일 후속 질문 및 개학 확인 질문 — Engine 범위 밖의 순수 캘린더 규칙.
  const kPeerPersona = await fetchKPeerPersonaForChild(service, session.child_id);
  const businessDate = getKstBusinessDate();
  const activeVacationContext = await getActiveVacationContext(service, session.child_id);
  const vacationBlockState = resolveSchoolQuestionBlockState(activeVacationContext, businessDate);
  const realGrade = parseGrade(kPeerPersona.gradeLabel) ?? 4;

  if (vacationBlockState.needsSchoolStartDateQuestion) {
    const followUpQ = getVacationFollowUpQuestion(realGrade);
    await markVacationQuestionAsked(service, session.child_id, businessDate);
    return NextResponse.json({ text: followUpQ, category: "vacation_followup", flaggedForParent: false, model: "vacation_rule" });
  } else if (vacationBlockState.needsSchoolStartConfirmationQuestion) {
    const confirmQ = getSchoolStartConfirmationQuestion(realGrade);
    await markVacationQuestionAsked(service, session.child_id, businessDate);
    return NextResponse.json({ text: confirmQ, category: "vacation_confirmation", flaggedForParent: false, model: "vacation_rule" });
  }

  // 기억 회상(Memory Recall) 질의 — 저장된 기억 밖 내용을 지어내면 안 되는 특수 경로라
  // 071 Engine에 흡수하지 않고 전용 하이-그라운딩 응답기를 그대로 유지한다.
  if (isMemoryRecallQuery(childText)) {
    const memoryRes = await generateMemoryRecallResponse(service, session.child_id, childText);
    if (memoryRes && memoryRes.text) {
      recordLlmUsage(sessionId, memoryRes.tokenIn, memoryRes.tokenOut);
      return NextResponse.json({ text: memoryRes.text, category: "memory_recall", flaggedForParent: false, model: FREE_CHAT_MODEL_ID });
    }
    // 기억이 없거나 오류 시 자연스럽게 아래 Engine 경로로 폴백
  }

  // 나머지 전부(Persona/Memory/Boredom/Action/Response — Safety는 위에서 이미 확인했고
  // Engine 내부에서 다시 확인해도 부작용 없음)는 K Conversation Engine이 처리한다.
  const isLowConfidenceAsr =
    typeof body.asrConfidence === "number" && body.asrConfidence < LOW_ASR_CONFIDENCE_THRESHOLD;

  // codex-rv 지적: createGenAIClient()를 여기서 즉시 생성하면 자격증명 문제가 결정론적
  // 경로(unclear_audio/app_mode_question)까지 500으로 만든다. Engine이 실제로 Gemini를
  // 호출하는 순간(generateResponse 내부)에만 클라이언트를 만들도록 지연시킨다.
  const lazyAi: GenerateArgs["ai"] = {
    models: {
      generateContent: (params) => createGenAIClient({ provider: "vertex" }).models.generateContent(params),
    },
  };

  const engineOutput = await respondWithEngine(
    {
      childId: session.child_id,
      sessionId,
      mode: "FREE_CHAT",
      currentUtterance: childText,
      asrConfidence: isLowConfidenceAsr ? 0 : 1,
      appMode: body.appMode === "manual" ? "manual" : "auto",
    },
    {
      db: service,
      ai: lazyAi,
      modelId: FREE_CHAT_MODEL_ID,
    },
  );

  if (engineOutput.tokenIn > 0 || engineOutput.tokenOut > 0) {
    recordLlmUsage(sessionId, engineOutput.tokenIn, engineOutput.tokenOut);
  }

  return NextResponse.json({
    text: engineOutput.text,
    category: engineOutput.category,
    flaggedForParent: engineOutput.safetyFlagged ?? false,
    model: engineOutput.category === "generated" ? FREE_CHAT_MODEL_ID : "rule_engine",
  });
}
