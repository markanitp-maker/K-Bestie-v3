import { NextRequest, NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { MISSION_CHAT_SYSTEM_PROMPT, WEEKEND_QUESTION_PROMPT } from "@/app/api/_lib/prompts";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import { checkConsentForSession } from "@/lib/plan/consentGuard";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; history?: HistoryTurn[]; nextQuestionText?: string; childTurnId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const nextQuestionText = typeof body.nextQuestionText === "string" ? body.nextQuestionText.trim() : "";
  const childTurnId = typeof body.childTurnId === "string" ? body.childTurnId : null;

  if (history.length === 0 || !nextQuestionText) {
    return NextResponse.json({ error: "history and nextQuestionText required" }, { status: 400 });
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const consentBlocked = await checkConsentForSession(body.sessionId);
  if (consentBlocked) return consentBlocked;

  const authService = createServiceClient();
  const { data: session } = await authService
    .from("chat_sessions")
    .select("child_id")
    .eq("id", body.sessionId)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(authService, user.id, session.child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  // Parent question injection & evaluation
  let activeQuestion = null;
  const { data: qs } = await authService
    .from("parent_questions")
    .select("*")
    .eq("child_id", session.child_id)
    .in("status", ["ai_generated", "parent_edited", "mission_confirming"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (qs && qs.length > 0) {
    activeQuestion = qs[0];
  }

  if (activeQuestion) {
    if (activeQuestion.status === "mission_confirming") {
      const childLastTurn = history[history.length - 1];
      if (childLastTurn && childLastTurn.role === "child") {
        try {
          const evalAi = createGenAIClient(missionModel);
          const evalPrompt = `방금 케이가 아이에게 다음 질문을 했습니다: "${activeQuestion.question_text}"\n아이의 대답: "${childLastTurn.text}"\n\n아이가 질문에 명확히 응답했는지, 거부했는지, 아니면 모호하거나 다른 주제로 넘어갔는지 판정하세요. 반드시 JSON 형식으로만 반환하세요. JSON 외 텍스트 금지.\n형식: {"verdict": "answered" | "refused" | "unclear", "summary": "아이가 대답한 내용의 요약 (answered인 경우에만 작성)"}`;
          const evalRes = await evalAi.models.generateContent({
             model: missionModel.modelId, // for accurate analysis
             contents: [{ role: "user", parts: [{ text: evalPrompt }] }],
          });
          const parsed = extractJSON(evalRes.text || "{}");
          
          if (parsed.verdict === "answered") {
            await authService.from("parent_questions").update({
              status: "confirmed",
              child_answer_summary: parsed.summary
            }).eq("id", activeQuestion.id);
            activeQuestion = null;
          } else if (parsed.verdict === "refused") {
            await authService.from("parent_questions").update({
              status: "declined"
            }).eq("id", activeQuestion.id);
            activeQuestion = null;
          } else {
            const attempts = (activeQuestion.mission_confirm_attempts || 0) + 1;
            if (attempts >= 2) {
              await authService.from("parent_questions").update({
                status: "mission_incomplete",
                mission_confirm_attempts: attempts
              }).eq("id", activeQuestion.id);
              activeQuestion = null;
            } else {
              await authService.from("parent_questions").update({
                mission_confirm_attempts: attempts
              }).eq("id", activeQuestion.id);
              finalNextQuestionText = `방금 물어본 질문("${activeQuestion.question_text}")에 대해 아직 아이가 대답하지 않았으니 부드럽게 다시 한 번 물어보세요.`;
              activeQuestion.status = "mission_confirming";
            }
          }
        } catch (err) {
          console.error("Parent question eval error", err);
        }
      }
    }
    
    // Inject if ready
    if (activeQuestion && (activeQuestion.status === "ai_generated" || activeQuestion.status === "parent_edited")) {
      await authService.from("parent_questions").update({
        status: "mission_confirming",
        mission_confirm_attempts: 1
      }).eq("id", activeQuestion.id);
      finalNextQuestionText = activeQuestion.question_text;
    }
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: finalNextQuestionText }] });
  }

  const systemInstruction = `
${MISSION_CHAT_SYSTEM_PROMPT}

지금 아이에게 자연스럽게 이어서 물어봐야 할 다음 질문은 "${finalNextQuestionText}"예요. 이 질문의 요지를 반드시 살려서 자연스럽게 물어보세요.
${isWeekendQuestionDay() ? `\n${WEEKEND_QUESTION_PROMPT}` : ""}
`.trim();

  try {
    const result = await ai.models.generateContent({
      model: missionModel.modelId,
      contents,
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        maxOutputTokens: missionModel.maxOutputTokens ?? 1024,
      },
    });

    let text = (result.text ?? "").trim();

    const isInvalid = (t: string) => {
      if (!t || containsPromptLeak(t)) return true;
      const qCount = (t.match(/\?/g) ?? []).length;
      return t.length > 40 || qCount > 1;
    };

    if (isInvalid(text)) {
      console.warn("[mission/respond] length/question/leak limit exceeded, retrying once...");
      try {
        const retryResult = await ai.models.generateContent({
          model: missionModel.modelId,
          contents,
          config: {
            systemInstruction: { parts: [{ text: systemInstruction + "\n\n(경고: 이전 응답이 너무 길거나 물음표가 많습니다. 반드시 40자 이내로 짧게, 물음표는 단 1개만 써서 대답하세요.)" }] },
            maxOutputTokens: missionModel.maxOutputTokens ?? 1024,
          },
        });
        text = (retryResult.text ?? "").trim();
      } catch (err) {
        console.error("[mission/respond] retry failed", err);
      }
      
      if (isInvalid(text)) {
        console.warn("[mission/respond] retry failed validation, falling back to safe text");
        text = `그렇구나! ${finalNextQuestionText}`;
        if (text.length > 40) {
          text = "그렇구나! 다음 질문으로 넘어갈게.";
        }
      }
    }

    if (childTurnId) setCachedRespond(childTurnId, text);

    // 길이 준수 진단 로그 — 원문은 남기지 않고 구조적 신호만(글자 수, 물음표 개수).
    const questionMarkCount = (text.match(/\?/g) ?? []).length;
    console.log("[mission/respond] length-compliance", {
      charCount: text.length,
      questionMarkCount,
      withinCharLimit: text.length <= 40,
      withinQuestionLimit: questionMarkCount <= 1,
    });

    const tokenIn = result.usageMetadata?.promptTokenCount;
    const tokenOut = result.usageMetadata?.candidatesTokenCount;
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
          });
        } catch (err) {
          console.error("[mission/respond] usage_events insert failed:", (err as Error).message);
        }
      });
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("[mission/respond] error:", (err as Error).message);
    return NextResponse.json({ error: "미션 응답 생성 실패" }, { status: 500 });
  }
}
