import { NextRequest, NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { MISSION_CHAT_SYSTEM_PROMPT, WEEKEND_QUESTION_PROMPT } from "@/app/api/_lib/prompts";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import { normalizeConversationMode } from "@/lib/plan/conversationMode";
import { checkConsentForSession } from "@/lib/plan/consentGuard";
import { checkApprovalForSession } from "@/lib/plan/approvalGuard";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { assertMissionSessionActive } from "@/app/api/_lib/missionUtils";
import { fetchVerifiedChildIdentity, buildKPeerPersonaFragment } from "@/lib/persona/kPeerPersona";
import { TRANSITION_CONNECTOR_POOL } from "@/lib/mission/eReactionPool";
import { isMemoryRecallQuery } from "@/lib/freechat/memoryRecallTrigger";
import { generateMemoryRecallResponse } from "@/lib/freechat/memoryRecallResponder";
import { getKstBusinessDate } from "@/lib/utils/kstBusinessDate";
import { getActiveVacationContext, resolveSchoolQuestionBlockState, getVacationFollowUpQuestion, getSchoolStartConfirmationQuestion, markVacationQuestionAsked, filterSchoolRequiredQuestion } from "@/lib/plan/vacationSchoolContext";
import { parseGrade } from "@/lib/mission/selectQuestions";
import { buildRelationshipContext } from "@/lib/relationship/relationshipContext";

export const runtime = "nodejs";


interface HistoryTurn { role: "child" | "k"; text: string }

/** KST(UTC+9) 기준 오늘이 목요일(4) 또는 금요일(5)인지 — 주말 질문을 자연스럽게 꺼낼 요일. */
function isWeekendQuestionDay(): boolean {
  const kstDay = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay(); // 0=일 ... 4=목, 5=금
  return kstDay === 4 || kstDay === 5;
}

function extractJSON(text: string) {
  try {
    const cleanText = text.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(cleanText);
  } catch {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch {}
    }
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]); } catch {}
    }
    console.error("JSON 추출 실패. 원문(300자):", text.substring(0, 300));
    throw new Error("JSON 파싱 오류");
  }
}

// 모델 응답에 프롬프트/지시문이 그대로 새어나온 흔적이 있는지 검사 — 감지되면 부분 절삭
// 없이 응답 전체를 폐기하는 판단 기준으로만 쓴다(아래 POST 핸들러 참고).
const PROMPT_LEAK_PATTERNS = [
  /\[[^\]]*\]/, // 대괄호로 감싼 헤더/라벨
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

// childTurnId 기준 짧은 TTL 인메모리 캐시 — 클라이언트 쪽 레이스로 같은 아이 턴에 대해
// 이 라우트가 중복 호출돼도 LLM을 두 번 부르지 않고 첫 응답을 재사용한다. 서버리스
// 인스턴스별로만 유효한 best-effort 가드이며(DB 스키마 변경 없음), 주 방어선은
// 클라이언트의 재진입 가드(app/child/missions/page.tsx)다.
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

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("[mission/respond] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    sessionId?: string;
    history?: HistoryTurn[];
    nextQuestionText?: string;
    childTurnId?: string;
    childContext?: any;
    parentQuestionOnly?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    console.error("[mission/respond] Invalid JSON");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const lastChildTurn = [...history].reverse().find((t) => t.role === "child" && t.text?.trim());
  const nextQuestionText = typeof body.nextQuestionText === "string" ? body.nextQuestionText.trim() : "";
  const childTurnId = typeof body.childTurnId === "string" ? body.childTurnId : null;

  if (history.length === 0 || !nextQuestionText) {
    console.error("[mission/respond] history and nextQuestionText required", { sessionId: body.sessionId, childTurnId });
    return NextResponse.json({ error: "history and nextQuestionText required" }, { status: 400 });
  }
  if (!body.sessionId) {
    console.error("[mission/respond] sessionId required", { childTurnId });
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  console.log("[mission/respond] start", { sessionId: body.sessionId, childTurnId, mode: "stt_tts" });

  const consentBlocked = await checkConsentForSession(body.sessionId);
  if (consentBlocked) {
    console.error("[mission/respond] consent blocked", { sessionId: body.sessionId, childTurnId });
    return consentBlocked;
  }

  const approvalBlocked = await checkApprovalForSession(body.sessionId);
  if (approvalBlocked) return approvalBlocked;

  const authService = createServiceClient();
  const { data: session } = await authService
    .from("chat_sessions")
    .select("child_id")
    .eq("id", body.sessionId)
    .single();
  if (!session) {
    console.error("[mission/respond] Session not found", { sessionId: body.sessionId, childTurnId });
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(authService, user.id, session.child_id);
  if (!authCheck.allowed) {
    console.error("[mission/respond] Forbidden", { sessionId: body.sessionId, childTurnId });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 요청서(케이 동갑내기 페르소나) — 클라이언트가 보낸 body.childContext(이름/학년)를
  // 그대로 신뢰하지 않는다. 위에서 이미 검증된 session.child_id로 서버가 새로 조회한
  // 값만 정체성 프롬프트에 쓴다(스푸핑·형제자매 정보 혼입 방지).
  const verifiedIdentity = await fetchVerifiedChildIdentity(authService, session.child_id);

  const sessionCheck = await assertMissionSessionActive(authService, body.sessionId);
  if (!sessionCheck.allowed) {
    console.error("[mission/respond] Session not active or expired", { sessionId: body.sessionId, childTurnId });
    return NextResponse.json(
      { error: sessionCheck.error, code: sessionCheck.code, status: sessionCheck.status, expired: sessionCheck.expired },
      { status: sessionCheck.expired ? 403 : 423 }
    );
  }

  // C. 순서 강제: 직전 메시지가 k인지 확인
  const { data: lastMsg, error: lastMsgError } = await authService
    .from("chat_messages")
    .select("role")
    .eq("session_id", body.sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastMsgError) {
    console.error("[mission/respond] order-check query failed", { sessionId: body.sessionId, childTurnId, error: lastMsgError.message });
  } else if (lastMsg && lastMsg.role === "k") {
    console.error("[order-violation] K without child turn", { sessionId: body.sessionId, childTurnId });
    // 연속 질문 차단 (409 Conflict 반환)
    return NextResponse.json({ error: "Conflict: Waiting for child answer" }, { status: 409 });
  }

  if (childTurnId) {
    const cached = getCachedRespond(childTurnId);
    if (cached !== null) {
      return NextResponse.json({ text: cached });
    }
  }

  const missionModel = await getModelForGroup("B");
  let ai;
  try {
    ai = createGenAIClient(missionModel);
  } catch (err) {
    console.error("[mission/respond] AI client creation failed", { sessionId: body.sessionId, childTurnId, error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // contents mapping (k -> model, child -> user)
  const contents = history
    .filter((t) => t.text?.trim())
    .map((t) => ({
      role: t.role === "k" ? ("model" as const) : ("user" as const),
      parts: [{ text: t.text }],
    }));

  // Gemini는 대화가 반드시 user 역할로 시작해야 함
  while (contents.length > 0 && contents[0].role === "model") {
    contents.shift();
  }

  let finalNextQuestionText = nextQuestionText;

  // Parent question injection. ai_generated/parent_edited are the canonical
  // ready states; mission_confirming means a question has been claimed.
  let activeQuestion: Record<string, any> | null = null;
  const kTexts = history.filter((turn) => turn.role === "k").map((turn) => turn.text);

  const { data: activeRows, error: activeQueryError } = await authService
    .from("parent_questions")
    .select("*")
    .eq("child_id", session.child_id)
    .eq("status", "mission_confirming")
    .order("last_delivered_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (activeQueryError) {
    console.error("[mission/respond] active parent question query failed", {
      childId: session.child_id,
      error: activeQueryError.message,
    });
  }

  const claimedElsewhere = activeRows?.[0] ?? null;
  const claimedElsewhereDeliveredText = claimedElsewhere
    ? claimedElsewhere.confirmation_question_text || claimedElsewhere.question_text
    : null;
  if (
    claimedElsewhere &&
    claimedElsewhereDeliveredText &&
    kTexts.some((text) => text.includes(claimedElsewhereDeliveredText))
  ) {
    // The question is already present in this mission transcript. If it is
    // still active here, the previous answer/connection did not finish the
    // lifecycle. Close it without repeating the same question immediately.
    const { error: recoveryError } = await authService
      .from("parent_questions")
      .update({
        status: "mission_incomplete",
        mission_confirm_attempts: Math.min(
          2,
          (claimedElsewhere.mission_confirm_attempts ?? 0) + 1,
        ),
      })
      .eq("id", claimedElsewhere.id)
      .eq("status", "mission_confirming");
    if (recoveryError) {
      console.error("[mission/respond] stale parent question recovery failed", {
        childId: session.child_id,
        questionId: claimedElsewhere.id,
        error: recoveryError.message,
      });
    }
  } else if (!claimedElsewhere) {
    const { data: knownQuestions, error: knownQuestionsError } = await authService
      .from("parent_questions")
      .select("question_text, confirmation_question_text")
      .eq("child_id", session.child_id)
      .not("status", "eq", "draft");

    if (knownQuestionsError) {
      console.error("[mission/respond] parent question history query failed", {
        childId: session.child_id,
        error: knownQuestionsError.message,
      });
    }

    const alreadyAskedInSession = (knownQuestions ?? []).some((question) =>
      kTexts.some(
        (text) =>
          text.includes(question.question_text) ||
          (question.confirmation_question_text && text.includes(question.confirmation_question_text)),
      ),
    );

    if (!alreadyAskedInSession) {
      // requests/request-parent-question-feature.md §6 — reconfirm_pending(1차 답변을
      // 재확인해야 하는 질문)도 함께 claim 대상에 포함한다. ai_generated/parent_edited는
      // 원본 질문을 물어보는 최초 전달이고, reconfirm_pending은 그 답변이 맞는지 되짚어
      // 묻는 재확인 전달이다 — 우선순위는 재확인이 먼저(아이가 이미 답한 질문을 방치하지
      // 않기 위해 created_at 무관하게 재확인 대기 건을 먼저 처리).
      let { data: reconfirmRows, error: reconfirmQueryError } = await authService
        .from("parent_questions")
        .select("id, status, delivered_count, confirmation_question_text")
        .eq("child_id", session.child_id)
        .eq("status", "reconfirm_pending")
        .order("created_at", { ascending: true })
        .limit(1);

      if (reconfirmQueryError) {
        console.error("[mission/respond] reconfirm parent question query failed", {
          childId: session.child_id,
          error: reconfirmQueryError.message,
        });
      }

      let readyRows = reconfirmRows;
      let readyQueryError = reconfirmQueryError;

      if (!readyRows?.length) {
        const readyResult = await authService
          .from("parent_questions")
          .select("id, status, delivered_count, confirmation_question_text")
          .eq("child_id", session.child_id)
          .in("status", ["ai_generated", "parent_edited"])
          .order("created_at", { ascending: true })
          .limit(1);
        readyRows = readyResult.data;
        readyQueryError = readyResult.error;
      }

      if (readyQueryError) {
        console.error("[mission/respond] ready parent question query failed", {
          childId: session.child_id,
          error: readyQueryError.message,
        });
      }

      // Compatibility for K-Chat rows created by the previous release. A draft
      // carrying both K-Chat snapshot fields has already completed conversion.
      if (!readyRows?.length) {
        const legacyResult = await authService
          .from("parent_questions")
          .select("id, status, delivered_count, confirmation_question_text")
          .eq("child_id", session.child_id)
          .eq("status", "draft")
          .not("parent_id", "is", null)
          .not("original_question_text", "is", null)
          .order("created_at", { ascending: true })
          .limit(1);
        readyRows = legacyResult.data;
        readyQueryError = legacyResult.error;
      }

      const candidate = readyRows?.[0];
      if (candidate && !readyQueryError) {
        const deliveredCount = candidate.delivered_count ?? 0;
        // Compare-and-set makes the claim exclusive even if two mission
        // sessions selected the same oldest row at the same time.
        const { data: updated, error: claimError } = await authService
          .from("parent_questions")
          .update({
            status: "mission_confirming",
            mission_confirm_attempts: 0,
            delivered_count: deliveredCount + 1,
            last_delivered_at: new Date().toISOString(),
          })
          .eq("id", candidate.id)
          .eq("status", candidate.status)
          .eq("delivered_count", deliveredCount)
          .select()
          .maybeSingle();

        if (claimError) {
          console.error("[mission/respond] parent question claim failed", {
            childId: session.child_id,
            questionId: candidate.id,
            error: claimError.message,
          });
        }
        if (updated) {
          activeQuestion = updated;
        }
      }
    }
  }

  let vacationQuestionAskedDate: string | null = null;

  if (activeQuestion) {
    if (activeQuestion.status === "mission_confirming") {
      // confirmation_question_text가 있으면 이 delivery는 "재확인" 턴이다 — 원본
      // 질문이 아니라 재확인 질문을 그대로 물어본다.
      const textToAsk = activeQuestion.confirmation_question_text || activeQuestion.question_text;
      if (activeQuestion.mission_confirm_attempts > 0) {
        finalNextQuestionText = `방금 물어본 질문("${textToAsk}")에 대해 아직 대답하지 않았으니 부드럽게 다시 한 번 물어보세요.`;
      } else {
        finalNextQuestionText = textToAsk;
      }
    }
  } else {
    const businessDate = getKstBusinessDate();
    const activeVacationContext = await getActiveVacationContext(authService, session.child_id);
    const vacationBlockState = resolveSchoolQuestionBlockState(activeVacationContext, businessDate);
    const realGrade = parseGrade(verifiedIdentity.persona.gradeLabel) ?? 4;

    if (vacationBlockState.needsSchoolStartDateQuestion) {

      finalNextQuestionText = getVacationFollowUpQuestion(realGrade);
      vacationQuestionAskedDate = businessDate;
    } else if (vacationBlockState.needsSchoolStartConfirmationQuestion) {
      finalNextQuestionText = getSchoolStartConfirmationQuestion(realGrade);
      vacationQuestionAskedDate = businessDate;
    } else if (vacationBlockState.blocked) {

      finalNextQuestionText = await filterSchoolRequiredQuestion(authService, finalNextQuestionText, true, realGrade);
    }
  }


  if (body.parentQuestionOnly) {
    // §6 재확인 턴이면 confirmation_question_text를 그대로 물어야 한다 — 위
    // finalNextQuestionText 계산부와 동일한 우선순위를 따른다(원본 질문으로 되돌아가면
    // 재확인 상태머신이 끊긴다).
    const text = activeQuestion?.confirmation_question_text || activeQuestion?.question_text || null;
    if (text && childTurnId) setCachedRespond(childTurnId, text);
    console.log("[mission/respond] parent-question-only done", {
      sessionId: body.sessionId,
      childTurnId,
      claimed: !!text,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      text,
      parentQuestionId: activeQuestion?.id ?? null,
    });
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: finalNextQuestionText }] });
  }

  const knownContextMsg = verifiedIdentity.givenName
    ? `아이의 이름은 '${verifiedIdentity.givenName}'이고 ${verifiedIdentity.persona.gradeLabel}입니다. 아이가 자기 이름이나 학년을 물어보면 모른다고 하지 말고 알고 있는 정보를 자연스럽게 말해주세요.\n`
    : "";

  const createSystemInstruction = (relationshipContextFragment = "") => `
${MISSION_CHAT_SYSTEM_PROMPT}

${buildKPeerPersonaFragment(verifiedIdentity.persona, { compact: true })}

${relationshipContextFragment}

${knownContextMsg}절대 질문을 생성하지 마세요. 아이의 이전 말에 대한 매우 짧은 공감이나 감탄사(리액션)만 딱 1~2문장(최대 15자)으로 생성하세요. 물음표(?)는 절대 사용 금지.
예: "우와, 정말 재밌었겠다!", "그렇구나!", "대단한데!"
`.trim();
  let systemInstruction = createSystemInstruction();

  try {
    if (body.sessionId && childTurnId) {
      const sId = body.sessionId;
      const tId = childTurnId;
      createServiceClient().from("turn_timing_events").insert({
        session_id: sId,
        turn_id: tId,
        event_name: "vertex_request"
      }).then(({error}) => { if (error) console.error("[mission/respond] timing err", error.message); }, (e: unknown) => console.error("[mission/respond] timing exc", e));
    }

    let reaction = "";
    let tokenIn: number | undefined;
    let tokenOut: number | undefined;
    let didFallback = false;
    let usedMemoryRecall = false;

    // 기억 회상(Memory Recall) 질의 감지 — 아이의 마지막 발화가 "저번에 내가 말한 거
    // 기억나?" 류 회상형 질문이면, 리액션 생성 대신 저장된 기억 기반 답변으로 대체한다.
    // 실패/기억 없음이면 아래의 일반 리액션 생성으로 자연스럽게 폴백한다. 다음 질문
    // (finalNextQuestionText)은 그대로 이어붙이므로 미션 진행 흐름에는 영향이 없다.
    if (lastChildTurn?.text && isMemoryRecallQuery(lastChildTurn.text)) {
      const memoryRes = await generateMemoryRecallResponse(authService, session.child_id, lastChildTurn.text);
      if (memoryRes && memoryRes.text && !containsPromptLeak(memoryRes.text)) {
        reaction = memoryRes.text;
        tokenIn = memoryRes.tokenIn;
        tokenOut = memoryRes.tokenOut;
        usedMemoryRecall = true;
      }
    }

    // 명시적 회상 답변이 확정되지 않은 일반 미션 턴은 모두 같은 Relationship Context
    // Builder를 거친다. parentQuestionOnly는 위에서 이미 반환되므로 parent_questions의
    // 전달 우선순위와 질문 상태머신은 이 개인화 context가 절대 바꾸지 않는다.
    if (!usedMemoryRecall && lastChildTurn?.text) {
      const relationshipContext = await buildRelationshipContext(authService, {
        childId: session.child_id,
        sessionId: body.sessionId,
        currentText: lastChildTurn.text,
        mode: "mission",
      });
      systemInstruction = createSystemInstruction(relationshipContext.fragment);
    }

    const attemptGeneration = async (isFallback: boolean, customInstruction?: string) => {
      const currentModelId = isFallback ? getLlmModel("missionReactionFallback") : getLlmModel("missionReaction");
      const currentAi = isFallback ? createGenAIClient(await getModelForGroup("B")) : ai;
      const instructionText = customInstruction || systemInstruction;
      
      const res = await currentAi.models.generateContent({
        model: currentModelId,
        contents,
        config: {
          systemInstruction: { parts: [{ text: instructionText }] },
          maxOutputTokens: missionModel.maxOutputTokens ?? 1024,
          thinkingConfig: { thinkingLevel: 'MINIMAL' as any },
        },
      });
      
      const text = (res.text ?? "").trim();
      if (!text) throw new Error("Empty response body");
      
      tokenIn = res.usageMetadata?.promptTokenCount ?? tokenIn;
      tokenOut = res.usageMetadata?.candidatesTokenCount ?? tokenOut;
      return text;
    };

    if (!usedMemoryRecall) {
      try {
        reaction = await attemptGeneration(false);
      } catch (err: any) {
        if (isFallbackableError(err)) {
          console.warn(`[mission/respond] model fallback to Flash. Reason: ${err?.message || String(err)}`);
          didFallback = true;
          reaction = await attemptGeneration(true);
        } else {
          console.error(`[mission/respond] non-fallbackable error: ${err?.message || String(err)}`);
          throw err;
        }
      }

      const isInvalid = (t: string) => {
        if (!t || containsPromptLeak(t)) return true;
        const qCount = (t.match(/\?/g) ?? []).length;
        return t.length > 15 || qCount > 0;
      };

      if (isInvalid(reaction)) {
        console.warn("[mission/respond] length/question/leak limit exceeded, retrying once...");
        try {
          reaction = await attemptGeneration(
            didFallback,
            systemInstruction + "\n\n(경고: 이전 리액션에 물음표가 있거나 너무 깁니다. 반드시 15자 이내로 짧게, 물음표 없이 출력하세요.)"
          );
        } catch (err) {
          console.error("[mission/respond] retry failed", err);
        }

        if (isInvalid(reaction)) {
          console.warn("[mission/respond] retry failed validation, falling back to safe text");
          reaction = "그렇구나!";
        }
      }
    }

    // vertex_request는 회상/일반 생성 분기 이전에 무조건 기록되므로, 완료 이벤트도
    // 두 분기 모두에서 대칭적으로 남긴다(review 지적: 비대칭 시 회상 응답 턴이
    // 지연시간 집계에서 영구 미완료로 보일 수 있음).
    if (body.sessionId && childTurnId) {
      const sId = body.sessionId;
      const tId = childTurnId;
      createServiceClient().from("turn_timing_events").insert([
        { session_id: sId, turn_id: tId, event_name: "vertex_first_chunk" },
        { session_id: sId, turn_id: tId, event_name: "vertex_complete" }
      ]).then(({error}) => { if (error) console.error("[mission/respond] timing err", error.message); }, (e: unknown) => console.error("[mission/respond] timing exc", e));
    }

    const connector = TRANSITION_CONNECTOR_POOL[Math.floor(Math.random() * TRANSITION_CONNECTOR_POOL.length)];
    const text = `${reaction} ${connector} ${finalNextQuestionText}`;

    if (childTurnId) setCachedRespond(childTurnId, text);

    // 길이 준수 진단 로그 — 원문은 남기지 않고 구조적 신호만(글자 수, 물음표 개수).
    const questionMarkCount = (reaction.match(/\?/g) ?? []).length;
    console.log("[mission/respond] length-compliance", {
      charCount: reaction.length,
      questionMarkCount,
      withinCharLimit: reaction.length <= 15,
      withinQuestionLimit: questionMarkCount === 0,
    });
    if (tokenIn != null && tokenOut != null && body.sessionId) {
      const sessionId = body.sessionId;
      after(async () => {
        try {
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
            conversation_mode: normalizeConversationMode((body as { conversationMode?: unknown }).conversationMode),
          });
        } catch (err) {
          console.error("[mission/respond] usage_events insert failed:", (err as Error).message);
        }
      });
    }

    if (vacationQuestionAskedDate) {
      await markVacationQuestionAsked(authService, session.child_id, vacationQuestionAskedDate);
    }

    console.log("[mission/respond] done", { sessionId: body.sessionId, childTurnId, durationMs: Date.now() - startedAt, status: "success" });
    return NextResponse.json({ text });

  } catch (err) {
    console.error("[mission/respond] error:", (err as Error).message, { sessionId: body.sessionId, childTurnId });
    return NextResponse.json({ error: "미션 응답 생성 실패" }, { status: 500 });
  }
}
