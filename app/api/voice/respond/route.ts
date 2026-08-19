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
import { createGenAIClient, FREE_CHAT_MODEL_ID } from "@/app/api/_lib/ai";
import { getKstBusinessDate } from "@/lib/utils/kstBusinessDate";
import {
  getActiveVacationContext,
  resolveSchoolQuestionBlockState,
  markVacationQuestionAsked,
} from "@/lib/plan/vacationSchoolContext";
import { resolveVacationChatInstruction } from "@/lib/freechat/vacationChatInstruction";
import { respond as respondWithEngine, checkSafetyPreflight, type GenerateArgs } from "@/lib/k-conversation";
import { resolveChildUtterance } from "@/lib/stt/serverRescoring";

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

/** id는 클라이언트 Turn.id — /api/chat/messages의 turnId, DB chat_messages.turn_id와 동일한
 * canonical ID다. Same-session Memory에서 현재 turn만 제외하는 데 쓴다(005). */
interface HistoryTurn { role: "child" | "k"; text: string; id?: string }

function isValidHistoryTurn(value: unknown): value is HistoryTurn {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row.id !== undefined && typeof row.id !== "string") return false;
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

  let body: { history?: unknown; sessionId?: string; asrConfidence?: number; appMode?: string; childTurnId?: string };
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
  const resolution = await resolveChildUtterance(
    service,
    session.child_id,
    sessionId,
    childText,
    "free_chat"
  );
  const resolvedChildText = resolution.text;

  // 현재 child turn의 canonical ID. /api/chat/messages 저장이 먼저 끝난 경우에도
  // Same-session Memory가 이 turn을 다시 가져오지 않도록 Engine까지 전달한다(005 §3-2).
  const currentTurnId =
    typeof body.childTurnId === "string" && body.childTurnId.trim() && body.childTurnId.length <= 200
      ? body.childTurnId.trim()
      : typeof lastChild.id === "string" && lastChild.id.trim() && lastChild.id.length <= 200
        ? lastChild.id.trim()
        : undefined;

  const executeGeneration = async () => {
    // Safety preflight — 원문(childText)과 재해석본(resolvedChildText)을 둘 다 검사한다 (§3-7).
    // 어느 쪽이든 걸리면 즉시 안전 응답을 반환한다. 바뀌지 않았으면 중복 호출하지 않는다.
    let safetyResult = await checkSafetyPreflight(service, sessionId, childText, {
      childId: session.child_id,
      mode: "FREE_CHAT",
      turnId: currentTurnId,
    });
    if (!safetyResult && resolution.changed) {
      safetyResult = await checkSafetyPreflight(service, sessionId, resolvedChildText, {
        childId: session.child_id,
        mode: "FREE_CHAT",
        turnId: currentTurnId,
      });
    }
    if (safetyResult) {
      return {
        text: safetyResult.text,
        category: safetyResult.category,
        flaggedForParent: safetyResult.safetyFlagged ?? false,
        model: "rule_engine",
      };
    }

    // 068/082: 방학/개학일 후속 질문 및 개학 확인 질문 — 대화를 가로채지 않고 Engine 지침(adapterInstruction)으로 전달
    const businessDate = getKstBusinessDate();
    const activeVacationContext = await getActiveVacationContext(service, session.child_id);
    const vacationBlockState = resolveSchoolQuestionBlockState(activeVacationContext, businessDate);

    const { instruction: vacationInstruction, markAskedRequired } = resolveVacationChatInstruction(
      resolvedChildText,
      vacationBlockState
    );

    if (markAskedRequired) {
      await markVacationQuestionAsked(service, session.child_id, businessDate);
    }

    // 기억 회상(Memory Recall) 질의 — 저장된 기억 밖 내용을 지어내면 안 되는 특수 경로라
    // 071 Engine에 흡수하지 않고 전용 하이-그라운딩 응답기를 그대로 유지한다.
    if (isMemoryRecallQuery(resolvedChildText)) {
      const memoryRes = await generateMemoryRecallResponse(service, session.child_id, resolvedChildText);
      if (memoryRes && memoryRes.text) {
        recordLlmUsage(sessionId, memoryRes.tokenIn, memoryRes.tokenOut);
        return { text: memoryRes.text, category: "memory_recall", flaggedForParent: false, model: FREE_CHAT_MODEL_ID };
      }
      // 기억이 없거나 오류 시 자연스럽게 아래 Engine 경로로 폴백
    }

    // 나머지 전부(Persona/Memory/Boredom/Action/Response — Safety는 위에서 이미 확인했고
    // Engine 내부에서 다시 확인해도 부작용 없음)는 K Conversation Engine이 처리한다.
    const isLowConfidenceAsr =
      typeof body.asrConfidence === "number" && body.asrConfidence < LOW_ASR_CONFIDENCE_THRESHOLD;

    const recentKTexts = history
      .filter((t) => t.role === "k" && t.text?.trim())
      .map((t) => t.text.trim());

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
        currentUtterance: resolvedChildText,
        currentTurnId,
        asrConfidence: isLowConfidenceAsr ? 0 : 1,
        appMode: body.appMode === "manual" ? "manual" : "auto",
        recentKTexts,
      },
      {
        db: service,
        ai: lazyAi,
        modelId: FREE_CHAT_MODEL_ID,
        adapterInstruction: vacationInstruction,
      },
    );

    if (engineOutput.tokenIn > 0 || engineOutput.tokenOut > 0) {
      recordLlmUsage(sessionId, engineOutput.tokenIn, engineOutput.tokenOut);
    }

    return {
      text: engineOutput.text,
      category: engineOutput.category,
      flaggedForParent: engineOutput.safetyFlagged ?? false,
      model: engineOutput.category === "generated" ? FREE_CHAT_MODEL_ID : "rule_engine",
      // 013 §3-12 — 턴이 끝난 뒤 살아 있는 놀이 스킬(없으면 null).
      // 클라이언트는 이 값으로만 놀이 종료를 판단한다. K 응답 문구를 파싱해
      // "그만" 여부를 추측하는 구현은 금지돼 있다 — 문구는 매번 달라진다.
      activePlaySkillId: engineOutput.activePlaySkillId ?? null,
    };
  };

  // 2026-08-17: 009 가 넣은 서버 캐시(completedResponses / inFlightRequests / DB 사전 조회)를
  // 전부 제거했다. 아이가 같은 말을 반복하면 같은 turnId 가 오는데, 캐시가 이전 응답을
  // 그대로 되돌려주는 바람에 케이가 새 대답을 만들지 않았다.
  // Production 에서 박서아·박서현 계정이 20분간 케이 응답 0건을 겪었고
  // 아이가 "도대체 인사 받는 게 왜 이렇게 힘드니" 라고 했다.
  //
  // 중복 저장은 chat_messages 의 UNIQUE(session_id, turn_id) 와
  // /api/chat/messages 의 onConflict + ignoreDuplicates 가 막는다.
  // 화면에 말풍선이 두 개 뜨는 사고는 그쪽에서 방지된다.
  //
  // 중복 응답은 어색할 뿐이지만 침묵은 아이가 무시당했다고 느낀다.
  const generated = await executeGeneration();
  return NextResponse.json(generated);
}
