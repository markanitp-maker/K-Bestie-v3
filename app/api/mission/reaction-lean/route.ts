import { NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveChildForUser } from "@/lib/child/testAccount";
import { createGenAIClient, LEAN_E_MODEL_ID, REACTION_LEAN_MAX_OUTPUT_TOKENS } from "@/app/api/_lib/ai";
import { after } from "next/server";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { assertMissionSessionActive } from "@/app/api/_lib/missionUtils";
import { getLlmModel } from "@/lib/llm/modelRouter";

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

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { questionText, answerText, sessionId, childTurnId, childContext } = body;

    if (typeof questionText !== "string" || typeof answerText !== "string" || !questionText || !answerText) {
      return new Response("Bad Request", { status: 400 });
    }

    const knownContextMsg = childContext && childContext.givenName
      ? `너는 아이의 이름을 이미 알고 있다. 아이의 이름은 '${childContext.givenName}'이며, ${childContext.grade}학년이다.`
      : "";
    const identityAnswerRule = childContext && childContext.givenName
      ? `\n- 아이가 자기 이름이나 학년을 물어보면, 이미 알고 있는 정보(${childContext.givenName}, ${childContext.grade}학년)를 활용해 자연스럽게 대답해라. 모른다고 하거나 다시 묻지 마라.`
      : "";

    // 대표님은 30~50자를 요청했으나, LLM 생성 시간 증가로 인한 응답 속도 저하(1초 내 첫 반응)를 막기 위해 20~35자로 절충함.
    const systemInstruction = `너는 아이와 대화하는 케이야. 아래 "질문"과 아이의 "답변"만 보고, 답변 내용에 어울리는 아주 짧은 반응 1문장만 만들어라.
${knownContextMsg}
- 아이 답변에서 화남·짜증·거부·슬픔·외로움 같은 부정적 감정이 뚜렷하면, 내용에 대한 일반적 공감 대신 사과하며 다시 말해달라고 자연스럽게 요청하는 반응을 해라. 정해진 문장을 그대로 쓰지 말고 매번 다른 표현으로 새로 만들어라.${identityAnswerRule}
- 그 외의 경우엔 아이가 답변에서 말한 구체적인 내용(단어)을 자연스럽게 반영한 공감 반응을 해라.
- 절대 새로운 질문을 만들지 마라. 물음표(?) 사용 금지.
- 한국어로 딱 1문장, 약 20~35자.
- 감정을 과도하게 단정하지 말고, 답변에 드러난 내용에 맞게만 반응해라.
- 반응 문장 외에 다른 말은 절대 출력하지 마라(설명, 따옴표, 라벨 없이 반응 문장만).`;

    const userPrompt = `질문: "${questionText}"\n아이의 답변: "${answerText}"`;

    // 인증/테스트계정 확인 및 승인 확인 (Gemini 호출 전에 대기)
    const authResult = await (async (): Promise<{ ok: true } | { ok: false; status: 401 | 403; res?: Response }> => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { ok: false, status: 401 };
      const svc = createServiceClient();
      const child = await resolveChildForUser(svc, user.id);
      if (!child) return { ok: false, status: 403 };
      
      const approvalBlocked = await checkApprovalForChild(child.childId);
      if (approvalBlocked) return { ok: false, status: 403, res: approvalBlocked };
      
      if (sessionId) {
        const sessionCheck = await assertMissionSessionActive(svc, sessionId);
        if (!sessionCheck.allowed) {
          const payload = JSON.stringify({ error: sessionCheck.error, code: sessionCheck.code, status: sessionCheck.status, expired: sessionCheck.expired });
          return { ok: false, status: sessionCheck.expired ? 403 : 403, res: new Response(payload, { status: sessionCheck.expired ? 403 : 423, headers: { "Content-Type": "application/json" } }) };
        }
      }

      return { ok: true };
    })();

    if (!authResult.ok) {
      if (authResult.res) return authResult.res;
      return new Response(authResult.status === 401 ? "Unauthorized" : "Forbidden", { status: authResult.status });
    }

    const ai = createGenAIClient({ provider: "vertex" });

    let tokenIn = 0;
    let tokenOut = 0;
    let textResult = "";

    const doGenerate = async (isFallback: boolean) => {
      const currentModelId = isFallback ? getLlmModel("missionReactionFallback") : getLlmModel("missionReaction");
      const res = await ai.models.generateContent({
        model: currentModelId,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction,
          maxOutputTokens: REACTION_LEAN_MAX_OUTPUT_TOKENS,
          temperature: 0.3,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      if (res.usageMetadata) {
        tokenIn = res.usageMetadata.promptTokenCount ?? tokenIn;
        tokenOut = res.usageMetadata.candidatesTokenCount ?? tokenOut;
      }
      return res.text || "";
    };

    try {
      textResult = await doGenerate(false);
    } catch (e: any) {
      if (isFallbackableError(e)) {
        console.warn(`[mission/reaction-lean] fallback to Flash. Reason: ${e?.message || String(e)}`);
        textResult = await doGenerate(true);
      } else {
        throw e;
      }
    }

    const stream = new ReadableStream({
      start(controller) {
        if (textResult) {
          controller.enqueue(new TextEncoder().encode(textResult));
        }
        controller.close();
      }
    });

    if (sessionId) {
      after(async () => {
        try {
          const serviceRole = createServiceClient();
          const usageCtx = await resolveUsageContext(sessionId);
          if (usageCtx) {
            const estCostKrw = estimateCost({ kind: "llm", tokenIn, tokenOut });
            await serviceRole.from("usage_events").insert({
              child_id: usageCtx.childId,
              tier: usageCtx.tier,
              voice_mode: usageCtx.voiceMode,
              kind: "llm",
              token_in: tokenIn,
              token_out: tokenOut,
              est_cost_krw: estCostKrw,
              conversation_mode: "E",
            });
          }
        } catch (e) {
          console.error("[reaction-lean] after() logging failed", e);
        }
      });
    }

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });

  } catch (e: any) {
    console.error("[reaction-lean] Error:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
