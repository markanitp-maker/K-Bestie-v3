import { NextRequest, NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { MISSION_CHAT_SYSTEM_PROMPT } from "@/app/api/_lib/prompts";
import {
  getModelForGroup,
  createGenAIClient,
  LEAN_E_MODEL_ID,
  LEAN_E_MAX_OUTPUT_TOKENS,
  GroupModelConfig,
} from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import { normalizeConversationMode } from "@/lib/plan/conversationMode";
import { checkConsentForSession } from "@/lib/plan/consentGuard";
import { checkApprovalForSession } from "@/lib/plan/approvalGuard";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { assertMissionSessionActive } from "@/app/api/_lib/missionUtils";
import { isMemoryRecallQuery } from "@/lib/freechat/memoryRecallTrigger";
import { generateMemoryRecallResponse } from "@/lib/freechat/memoryRecallResponder";
import { buildRelationshipContext } from "@/lib/relationship/relationshipContext";

export const runtime = "nodejs";

interface HistoryTurn { role: "child" | "k"; text: string }
type Content = { role: "user" | "model"; parts: { text: string }[] };

const PROMPT_LEAK_PATTERNS = [
  /\[[^\]]*\]/,
  /라고\s*말하면\s*돼/,
  /시스템\s*지시/,
  /현재\s*물어봐야\s*할/,
  /목표\s*질문/,
];
function containsPromptLeak(text: string): boolean {
  return PROMPT_LEAK_PATTERNS.some((re) => re.test(text));
}

function isFallbackableError(err: any): boolean {
  const errMsg = (err?.message || String(err)).toLowerCase();
  if (
    errMsg.includes("400") ||
    errMsg.includes("401") ||
    errMsg.includes("403") ||
    errMsg.includes("404") ||
    errMsg.includes("safety") ||
    errMsg.includes("blocked") ||
    errMsg.includes("validation") ||
    errMsg.includes("invalid") ||
    errMsg.includes("schema")
  ) {
    return false;
  }
  return true;
}

const respondCache = new Map<string, { text: string; ts: number }>();
const RESPOND_CACHE_TTL_MS = 15_000;
function getCachedRespond(key: string): string | null {
  const hit = respondCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > RESPOND_CACHE_TTL_MS) {
    respondCache.delete(key);
    return null;
  }
  return hit.text;
}
function setCachedRespond(key: string, text: string) {
  if (respondCache.size > 200) {
    const oldestKey = respondCache.keys().next().value;
    if (oldestKey) respondCache.delete(oldestKey);
  }
  respondCache.set(key, { text, ts: Date.now() });
}

interface LeanResult {
  reaction: string;
  tokenIn?: number;
  tokenOut?: number;
  modelUsed: string;
}

// childTurnId 기준 in-flight 공유 — 동일 턴에 대해 클라이언트 레이스로 이 라우트가 동시에
// 여러 번 호출돼도 LLM은 딱 한 번만 부르고, 나머지 요청은 이 Promise를 그대로 기다린다.
// (respondCache는 "완료된" 결과의 15초 재사용용이라 "진행 중" 동시요청의 중복 호출은 못 막는다.)
const inflightMap = new Map<string, Promise<LeanResult>>();

/** 리액션 텍스트를 생성한다. 클라이언트로는 검증을 통과한 최종 텍스트만 내보내야 하므로,
 *  스트림 청크를 여기서 전부 모아 검증까지 마친 뒤에 반환한다(중간 청크를 그대로 흘려보내면
 *  나중에 무효 판정이 나도 이미 전송된 원문을 되돌릴 수 없다). */
async function generateLeanReaction(params: {
  contents: Content[];
  sessionId: string;
  childTurnId: string | null;
  relationshipContextFragment: string;
}): Promise<LeanResult> {
  const { contents, sessionId, childTurnId, relationshipContextFragment } = params;

  const systemInstruction = `
${MISSION_CHAT_SYSTEM_PROMPT}

${relationshipContextFragment}

절대 질문을 생성하지 마세요. 아이의 이전 말에 대한 매우 짧은 공감이나 감탄사(리액션)만 딱 1~2문장(최대 15자)으로 생성하세요. 물음표(?)는 절대 사용 금지.
예: "우와, 정말 재밌었겠다!", "그렇구나!", "대단한데!"
`.trim();

  let modelUsed = getLlmModel("missionLean");
  const leanConfig: GroupModelConfig = {
    group: "B",
    provider: "vertex",
    modelId: getLlmModel("missionLean"),
  };

  const ai = createGenAIClient(leanConfig);

  if (sessionId && childTurnId) {
    createServiceClient().from("turn_timing_events").insert({
      session_id: sessionId,
      turn_id: childTurnId,
      event_name: "vertex_request",
    }).then(({ error }) => { if (error) console.error("[mission/respond-lean] timing err", error.message); }, (e: unknown) => console.error("[mission/respond-lean] timing exc", e));
  }

  let fullText = "";
  let tokenIn: number | undefined;
  let tokenOut: number | undefined;

  const attemptGeneration = async (isFallback: boolean) => {
    const currentModelId = isFallback ? getLlmModel("missionLeanFallback") : getLlmModel("missionLean");
    if (isFallback) {
      modelUsed = currentModelId;
    }
    
    let currentAi = ai;
    if (isFallback) {
      const fallbackGroupB = await getModelForGroup("B");
      currentAi = createGenAIClient(fallbackGroupB);
    }

    let responseStream: AsyncIterable<{ text?: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }>;
    try {
      responseStream = await currentAi.models.generateContentStream({
        model: currentModelId,
        contents,
        config: {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          maxOutputTokens: LEAN_E_MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: 'MINIMAL' as any },
        },
      });
    } catch {
      responseStream = await currentAi.models.generateContentStream({
        model: currentModelId,
        contents,
        config: {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          maxOutputTokens: LEAN_E_MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: 'MINIMAL' as any },
        },
      });
    }

    let tempText = "";
    let isFirstChunk = true;
    for await (const chunk of responseStream) {
      if (isFirstChunk) {
        isFirstChunk = false;
        if (sessionId && childTurnId && !isFallback) {
          createServiceClient().from("turn_timing_events").insert({
            session_id: sessionId,
            turn_id: childTurnId,
            event_name: "vertex_first_chunk",
          }).then(({ error }) => { if (error) console.error("[mission/respond-lean] timing err", error.message); }, (e: unknown) => console.error("[mission/respond-lean] timing exc", e));
        }
      }
      if (chunk.text) tempText += chunk.text;
      if (chunk.usageMetadata) {
        if (chunk.usageMetadata.promptTokenCount != null) tokenIn = chunk.usageMetadata.promptTokenCount;
        if (chunk.usageMetadata.candidatesTokenCount != null) tokenOut = chunk.usageMetadata.candidatesTokenCount;
      }
    }

    if (!tempText.trim()) {
      throw new Error("Empty response body");
    }
    
    fullText = tempText;
  };

  try {
    await attemptGeneration(false);
  } catch (err: any) {
    if (isFallbackableError(err)) {
      console.warn(`[mission/respond-lean] model fallback to Flash. Reason: ${err?.message || String(err)}`);
      await attemptGeneration(true);
    } else {
      console.error(`[mission/respond-lean] non-fallbackable error: ${err?.message || String(err)}`);
      throw err;
    }
  }

  if (sessionId && childTurnId) {
    createServiceClient().from("turn_timing_events").insert({
      session_id: sessionId,
      turn_id: childTurnId,
      event_name: "vertex_complete",
    }).then(({ error }) => { if (error) console.error("[mission/respond-lean] timing err", error.message); }, (e: unknown) => console.error("[mission/respond-lean] timing exc", e));
  }

  let reaction = fullText.trim();
  const isInvalid = (t: string) => {
    if (!t || containsPromptLeak(t)) return true;
    const qCount = (t.match(/\?/g) ?? []).length;
    return t.length > 15 || qCount > 0;
  };

  if (isInvalid(reaction)) {
    console.warn("[mission/respond-lean] reaction failed validation, falling back to safe text");
    reaction = "그렇구나!";
  }

  const questionMarkCount = (reaction.match(/\?/g) ?? []).length;
  console.log("[mission/respond-lean] length-compliance", {
    charCount: reaction.length,
    questionMarkCount,
    withinCharLimit: reaction.length <= 15,
    withinQuestionLimit: questionMarkCount === 0,
    modelUsed,
  });

  return { reaction, tokenIn, tokenOut, modelUsed };
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("[mission/respond-lean] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { sessionId?: string; history?: HistoryTurn[]; nextQuestionText?: string; childTurnId?: string; conversationMode?: unknown };
  try {
    body = await req.json();
  } catch {
    console.error("[mission/respond-lean] Invalid JSON");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const lastChildTurn = [...history].reverse().find((t) => t.role === "child" && t.text?.trim());
  const nextQuestionText = typeof body.nextQuestionText === "string" ? body.nextQuestionText.trim() : "";
  const childTurnId = typeof body.childTurnId === "string" ? body.childTurnId : null;

  if (history.length === 0 || !nextQuestionText) {
    console.error("[mission/respond-lean] history and nextQuestionText required", { sessionId: body.sessionId, childTurnId });
    return NextResponse.json({ error: "history and nextQuestionText required" }, { status: 400 });
  }
  if (!body.sessionId) {
    console.error("[mission/respond-lean] sessionId required", { childTurnId });
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const sessionId = body.sessionId;

  console.log("[mission/respond-lean] start", { sessionId, childTurnId, mode: "lean_stt_text" });

  const consentBlocked = await checkConsentForSession(sessionId);
  if (consentBlocked) return consentBlocked;

  const approvalBlocked = await checkApprovalForSession(sessionId);
  if (approvalBlocked) return approvalBlocked;

  const authService = createServiceClient();
  const { data: session } = await authService
    .from("chat_sessions")
    .select("child_id")
    .eq("id", sessionId)
    .single();
  if (!session) {
    console.error("[mission/respond-lean] Session not found", { sessionId, childTurnId });
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(authService, user.id, session.child_id);
  if (!authCheck.allowed) {
    console.error("[mission/respond-lean] Forbidden", { sessionId, childTurnId });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionCheck = await assertMissionSessionActive(authService, sessionId);
  if (!sessionCheck.allowed) {
    console.error("[mission/respond-lean] Session not active or expired", { sessionId, childTurnId });
    return NextResponse.json(
      { error: sessionCheck.error, code: sessionCheck.code, status: sessionCheck.status, expired: sessionCheck.expired },
      { status: sessionCheck.expired ? 403 : 423 }
    );
  }

  // K/child 순서가드: 직전 chat_messages가 role='k'면 409 Conflict 반환
  const { data: lastMsg, error: lastMsgError } = await authService
    .from("chat_messages")
    .select("role")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastMsgError) {
    console.error("[mission/respond-lean] order-check query failed", { sessionId, childTurnId, error: lastMsgError.message });
  } else if (lastMsg && lastMsg.role === "k") {
    console.error("[order-violation] K without child turn (lean)", { sessionId, childTurnId });
    return NextResponse.json({ error: "Conflict: Waiting for child answer" }, { status: 409 });
  }

  if (childTurnId) {
    const cached = getCachedRespond(childTurnId);
    if (cached !== null) {
      return new Response(cached, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  }

  const contents: Content[] = history
    .filter((t) => t.text?.trim())
    .map((t) => ({
      role: t.role === "k" ? ("model" as const) : ("user" as const),
      parts: [{ text: t.text }],
    }));

  while (contents.length > 0 && contents[0].role === "model") {
    contents.shift();
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: nextQuestionText }] });
  }

  // 기억 회상(Memory Recall) 감지·생성 자체를 in-flight 공유 대상 프라미스 안으로
  // 옮긴다 — 동일 childTurnId로 거의 동시에 두 번 호출돼도(클라이언트 레이스) 회상
  // 생성이 딱 한 번만 실행되도록 하기 위함(review 지적: 감지를 in-flight 체크보다
  // 먼저 실행하면 이 가드를 우회해 Vertex 호출·usage_events가 중복된다).
  const attemptMemoryRecallOrReaction = async (): Promise<LeanResult> => {
    if (lastChildTurn?.text && isMemoryRecallQuery(lastChildTurn.text)) {
      const memoryRes = await generateMemoryRecallResponse(authService, session.child_id, lastChildTurn.text);
      if (memoryRes && memoryRes.text && !containsPromptLeak(memoryRes.text)) {
        return {
          reaction: memoryRes.text,
          tokenIn: memoryRes.tokenIn,
          tokenOut: memoryRes.tokenOut,
          modelUsed: "memory_recall",
        };
      }
    }
    const relationshipContext = await buildRelationshipContext(authService, {
      childId: session.child_id,
      sessionId,
      currentText: lastChildTurn?.text ?? "",
      mode: "mission",
    });
    return generateLeanReaction({
      contents,
      sessionId,
      childTurnId,
      relationshipContextFragment: relationshipContext.fragment,
    });
  };

  let resultPromise: Promise<LeanResult>;
  // isOwner: 이 요청이 실제로 LLM 호출을 시작시켰는지 여부. in-flight를 공유만 하는 요청은
  // usage_events를 기록하지 않는다 — 안 그러면 동시요청 수만큼 실제 1회 LLM 비용이 중복 집계된다.
  let isOwner = false;
  {
    const existingInflight = childTurnId ? inflightMap.get(childTurnId) : undefined;
    if (existingInflight) {
      resultPromise = existingInflight;
    } else {
      isOwner = true;
      const promise = attemptMemoryRecallOrReaction();
      if (childTurnId) {
        inflightMap.set(childTurnId, promise);
        promise.finally(() => {
          if (inflightMap.get(childTurnId) === promise) inflightMap.delete(childTurnId);
        }).catch(() => {});
      }
      resultPromise = promise;
    }
  }

  let result: LeanResult;
  try {
    result = await resultPromise;
  } catch (err) {
    console.error("[mission/respond-lean] generation failed:", (err as Error)?.message, { sessionId, childTurnId });
    return NextResponse.json({ error: "미션 응답 생성 실패" }, { status: 500 });
  }

  if (childTurnId) setCachedRespond(childTurnId, result.reaction);

  const { tokenIn, tokenOut } = result;
  if (isOwner) after(async () => {
    try {
      if (tokenIn != null && tokenOut != null) {
        const ctx = await resolveUsageContext(sessionId);
        if (!ctx) return;
        const service = createServiceClient();
        const estCostKrw = estimateCost({ kind: "llm", tokenIn, tokenOut });
        await service.from("usage_events").insert({
          child_id: ctx.childId,
          tier: ctx.tier,
          voice_mode: ctx.voiceMode,
          kind: "llm",
          token_in: tokenIn,
          token_out: tokenOut,
          est_cost_krw: estCostKrw,
          conversation_mode: normalizeConversationMode(body.conversationMode ?? "E"),
        });
      }
    } catch (err) {
      console.error("[mission/respond-lean] usage_events insert failed:", (err as Error).message);
    }
  });

  console.log("[mission/respond-lean] done", { sessionId, childTurnId, durationMs: Date.now() - startedAt, status: "success" });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(result.reaction));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
