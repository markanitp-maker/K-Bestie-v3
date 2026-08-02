import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { pickReaction } from "@/lib/freeChatReactions";
import { generateReflectiveReaction } from "@/lib/freechat/reactionEngine";
import { checkConsentForSession } from "@/lib/plan/consentGuard";
import { checkApprovalForSession } from "@/lib/plan/approvalGuard";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { isMemoryRecallQuery } from "@/lib/freechat/memoryRecallTrigger";
import { generateMemoryRecallResponse } from "@/lib/freechat/memoryRecallResponder";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import { after } from "next/server";
import { FREE_CHAT_SYSTEM_PROMPT } from "@/app/api/_lib/prompts";
import {
  createGenAIClient,
  FREE_CHAT_MAX_OUTPUT_TOKENS,
  FREE_CHAT_MODEL_ID,
} from "@/app/api/_lib/ai";
import {
  buildFreeChatContents,
  validateFreeChatResponse,
  normalizeFreeChatResponse
} from "@/lib/freechat/geminiPolicy";

export const runtime = "nodejs";

// 047 QA 리뷰 지적([복잡]): direct_question/저신뢰ASR/Gemini 예외 폴백 등 규칙 엔진 응답은
// validateFreeChatResponse/normalizeFreeChatResponse를 거치지 않아, 자유대화에서도
// "그건 잘 모르겠어. 네가 알려줄래?"류 질문형 문장이 그대로 노출되고 있었다(원본 버그
// 리포트가 지적한 것과 동일 유형). 자유대화(session_type==="free_chat")로 나가는 모든
// 응답 경로가 반드시 이 함수를 거치도록 통일한다 — 검증 실패 시 고정 안전 폴백으로
// 대체하고, 미션 등 자유대화가 아닌 세션에는 전혀 영향을 주지 않는다.
function finalizeFreeChatText(text: string, sessionType: string | null | undefined): string {
  if (sessionType !== "free_chat") return text;
  if (!validateFreeChatResponse(text)) {
    return normalizeFreeChatResponse(text);
  }
  return text;
}

// 자유대화 응답 순서:
// 1) 안전 신호는 기존 규칙 엔진이 즉시 처리하고 보호자 이벤트를 기록한다.
// 2) 저신뢰 음성·앱 모드 질문은 사실성이 중요한 고정 응답을 사용한다.
// 3) 기억 회상은 저장된 기억만 근거로 Gemini 2.5 Flash Lite가 응답한다.
// 4) 일반 대화는 Gemini 2.5 Flash Lite가 응답하며, 호출 실패·무효 출력이면 기존
//    반영적 경청 엔진으로 폴백한다.

const LOW_ASR_CONFIDENCE_THRESHOLD = 0.55;

interface HistoryTurn { role: "child" | "k"; text: string }

function recordLlmUsage(
  sessionId: string,
  tokenIn: number,
  tokenOut: number
) {
  after(async () => {
    try {
      const ctx = await resolveUsageContext(sessionId);
      if (!ctx) return;
      const serviceRole = createServiceClient();
      const estCostKrw = estimateCost({
        kind: "llm",
        tokenIn,
        tokenOut,
      });
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
      console.error(
        "[voice/respond] usage_events insert failed:",
        (err as Error).message
      );
    }
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { history?: HistoryTurn[]; sessionId?: string; asrConfidence?: number; appMode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
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

  const consentBlocked = await checkConsentForSession(sessionId);
  if (consentBlocked) return consentBlocked;

  const approvalBlocked = await checkApprovalForSession(sessionId);
  if (approvalBlocked) return approvalBlocked;

  const lastChild = [...history].reverse().find((t) => t.role === "child" && t.text?.trim());
  if (!lastChild) {
    return NextResponse.json({ error: "no child utterance in history" }, { status: 400 });
  }
  const lastK = [...history].reverse().find((t) => t.role === "k" && t.text?.trim());

  // 1) 안전 검사 최우선 — 걸리면 반영적 경청 엔진은 아예 보지 않고 기존 안전 응답을 그대로 사용.
  const safetyCheck = pickReaction(lastChild.text.trim(), lastK?.text?.trim());

  if (safetyCheck.flaggedForParent) {
    const service = createServiceClient();
    const { error: insertError } = await service.from("safety_events").insert({
      session_id: sessionId,
      subcategory: safetyCheck.safetySubcategory,
      child_text: lastChild.text.trim(),
    });
    if (insertError) {
      console.error("[voice/respond] safety_events insert failed:", insertError.message);
    }
    return NextResponse.json({
      text: safetyCheck.text,
      category: safetyCheck.category,
      flaggedForParent: true,
    });
  }

  // 1.5) 기억 회상(Memory Recall) 질의 감지 및 처리
  const childText = lastChild.text.trim();
  if (isMemoryRecallQuery(childText)) {
    const memoryRes = await generateMemoryRecallResponse(service, session.child_id, childText);
    if (memoryRes && memoryRes.text) {
      recordLlmUsage(sessionId, memoryRes.tokenIn, memoryRes.tokenOut);

      return NextResponse.json({
        text: memoryRes.text,
        category: "memory_recall",
        flaggedForParent: false,
        model: FREE_CHAT_MODEL_ID,
      });
    }
    // 기억이 없거나 오류 시 자연스럽게 아래의 반영적 경청 엔진으로 폴백
  }


  // 규칙 엔진 결과는 저신뢰 음성·앱 모드의 정확한 응답 및 Gemini 장애 폴백에 사용한다.
  const recentKTexts = history
    .filter((t): t is HistoryTurn & { role: "k" } => t.role === "k" && !!t.text?.trim())
    .slice(-20)
    .map((t) => t.text.trim());

  const isLowConfidenceAsr =
    typeof body.asrConfidence === "number" && body.asrConfidence < LOW_ASR_CONFIDENCE_THRESHOLD;

  const reflective = generateReflectiveReaction(lastChild.text.trim(), recentKTexts, { isLowConfidenceAsr });

  if (isLowConfidenceAsr) {
    return NextResponse.json({
      text: finalizeFreeChatText(reflective.text, session.session_type),
      category: reflective.category,
      flaggedForParent: false,
      model: "rule_fallback",
    });
  }

  if (reflective.category === "app_mode_question") {
    const modeText = body.appMode === "manual" ? "수동" : "자동";
    return NextResponse.json({
      text: finalizeFreeChatText(`응, 지금은 ${modeText} 모드야.`, session.session_type),
      category: reflective.category,
      flaggedForParent: false,
      model: "rule_fallback",
    });
  }

  // 일반 지식·설명 질문에는 모델의 사전지식을 사용하지 않는다. 과거 대화에 대한
  // 질문은 위의 LLM WIKI 회상 경로에서 먼저 처리되며, 근거가 없거나 그 밖의 질문은
  // 정답을 지어내지 않고 아이에게 알려달라고 요청한다.
  if (reflective.category === "direct_question") {
    return NextResponse.json({
      text: finalizeFreeChatText("그건 잘 모르겠어. 네가 알려줄래?", session.session_type),
      category: reflective.category,
      flaggedForParent: false,
      model: "wiki_only_guard",
    });
  }

  try {
    const ai = createGenAIClient({ provider: "vertex" });
    const contents = buildFreeChatContents(history);
    const baseConfig = {
      systemInstruction: {
        parts: [{ text: FREE_CHAT_SYSTEM_PROMPT }],
      },
      thinkingConfig: { thinkingBudget: 0 },
      temperature: 0.7,
      maxOutputTokens: FREE_CHAT_MAX_OUTPUT_TOKENS,
    };
    let result = await ai.models.generateContent({
      model: FREE_CHAT_MODEL_ID,
      contents,
      config: baseConfig,
    });
    let text = result.text?.trim() ?? "";

    if (session.session_type === "free_chat") {
      if (!validateFreeChatResponse(text)) {
        result = await ai.models.generateContent({
          model: FREE_CHAT_MODEL_ID,
          contents,
          config: {
            ...baseConfig,
            systemInstruction: {
              parts: [
                {
                  text: `${FREE_CHAT_SYSTEM_PROMPT}\n\n이전 출력이 길이 또는 형식 규칙을 어겼습니다. 반드시 자연스러운 한국어 1줄, 30자 이내, 질문 없이 공감만으로 다시 답하세요.`,
                },
              ],
            },
            temperature: 0.4,
          },
        });
        text = result.text?.trim() ?? "";
      }
      text = normalizeFreeChatResponse(text);
    } else {
      // If used outside of free_chat, just return text as is (or apply some minimal fallback if empty)
      if (!text) text = "응, 듣고 있어.";
    }

    recordLlmUsage(
      sessionId,
      result.usageMetadata?.promptTokenCount ?? 0,
      result.usageMetadata?.candidatesTokenCount ?? 0
    );

    return NextResponse.json({
      text,
      category: reflective.category,
      flaggedForParent: false,
      model: FREE_CHAT_MODEL_ID,
    });
  } catch (err) {
    console.error("[voice/respond] Gemini fallback:", (err as Error).message);
    return NextResponse.json({
      text: finalizeFreeChatText(reflective.text, session.session_type),
      category: reflective.category,
      flaggedForParent: false,
      model: "rule_fallback",
    });
  }
}
