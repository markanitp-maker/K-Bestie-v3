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

export const runtime = "nodejs";

// 자유대화는 LLM을 호출하지 않는다 — 앱 자체 규칙 기반 엔진만 사용.
// 판단 순서: 1) 안전 검사 최우선(lib/freeChatReactions.ts의 pickReaction — category==="safety"면
//              그 결과를 그대로 사용, safety_events 저장까지 기존 로직 불변)
//           2) 안전이 아니면 15개 감정/상황 카테고리 반영적 경청 엔진(lib/freechat/reactionEngine.ts,
//              300여 개 분류 데이터셋 reactionSeed.json 기반)으로 반응 생성.
// 문장 풀/키워드 편집은 각 파일에서만 한다(이 파일은 로직 변경 불필요).
//
// (과거 이력: gemini-flash-lite-latest + FREE_CHAT_SYSTEM_PROMPT로 LLM 호출하던 구조였으나
//  반영적 경청 규칙 기반 엔진으로 전면 교체. 되돌릴 경우 git history의 이 파일 이전 버전 참고.)

const LOW_ASR_CONFIDENCE_THRESHOLD = 0.55;

interface HistoryTurn { role: "child" | "k"; text: string }

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
    .select("child_id")
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
      // 기록 남기기 (usage_events) - fire-and-forget
      after(async () => {
        try {
          const ctx = await resolveUsageContext(sessionId);
          if (!ctx) return;
          const serviceRole = createServiceClient();
          const estCostKrw = estimateCost({ kind: "llm", tokenIn: memoryRes.tokenIn, tokenOut: memoryRes.tokenOut });
          await serviceRole.from("usage_events").insert({
            child_id: ctx.childId,
            tier: ctx.tier,
            voice_mode: ctx.voiceMode,
            kind: "llm",
            token_in: memoryRes.tokenIn,
            token_out: memoryRes.tokenOut,
            est_cost_krw: estCostKrw,
            conversation_mode: null, // 자유대화는 A~E에 해당하지 않으므로 null (또는 생략)
          });
        } catch (err) {
          console.error("[voice/respond] usage_events insert failed:", (err as Error).message);
        }
      });

      return NextResponse.json({
        text: memoryRes.text,
        category: "memory_recall",
        flaggedForParent: false,
      });
    }
    // 기억이 없거나 오류 시 자연스럽게 아래의 반영적 경청 엔진으로 폴백
  }


  // 2) 안전이 아니면 15개 카테고리 반영적 경청 엔진으로 반응 생성.
  const recentKTexts = history
    .filter((t): t is HistoryTurn & { role: "k" } => t.role === "k" && !!t.text?.trim())
    .slice(-20)
    .map((t) => t.text.trim());

  const isLowConfidenceAsr =
    typeof body.asrConfidence === "number" && body.asrConfidence < LOW_ASR_CONFIDENCE_THRESHOLD;

  const reflective = generateReflectiveReaction(lastChild.text.trim(), recentKTexts, { isLowConfidenceAsr });

  if (reflective.category === "app_mode_question") {
    const modeText = body.appMode === "manual" ? "수동" : "자동";
    reflective.text = `응, 지금은 ${modeText} 모드야.`;
  }

  return NextResponse.json({
    text: reflective.text,
    category: reflective.category,
    flaggedForParent: false,
  });
}
