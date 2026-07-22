import { NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveTestChild } from "@/lib/child/testAccount";
import { createGenAIClient, LEAN_E_MODEL_ID, REACTION_LEAN_MAX_OUTPUT_TOKENS } from "@/app/api/_lib/ai";
import { after } from "next/server";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response("Unauthorized", { status: 401 });

    const svc = createServiceClient();
    const child = await resolveTestChild(svc, user.id);
    if (!child) return new Response("Forbidden", { status: 403 });

    const body = await req.json();
    const { questionText, answerText, sessionId, childTurnId } = body;

    if (typeof questionText !== "string" || typeof answerText !== "string" || !questionText || !answerText) {
      return new Response("Bad Request", { status: 400 });
    }

    const systemInstruction = `너는 아이와 대화하는 케이야. 아래 "질문"과 아이의 "답변"만 보고, 답변 내용에 어울리는 아주 짧은 공감 반응 1문장만 만들어라.
- 절대 새로운 질문을 만들지 마라. 물음표(?) 사용 금지.
- 한국어로 딱 1문장, 약 10~30자.
- 아이가 답변에서 말한 구체적인 내용(단어)을 자연스럽게 반영해라.
- 아이의 감정을 과도하게 단정하지 말고, 답변에 드러난 내용에 맞게만 반응해라.
- 반응 문장 외에 다른 말은 절대 출력하지 마라(설명, 따옴표, 라벨 없이 반응 문장만).`;

    const userPrompt = `질문: "${questionText}"\n아이의 답변: "${answerText}"`;

    const ai = createGenAIClient({ provider: "vertex" });

    // LLM 호출은 정확히 1회만 시도한다(요구사항 — 실패 시 같은 모델로도 재시도하지 않음).
    // 실패하면 여기서 그대로 던져 바깥 catch가 500을 반환하고, 클라이언트의 1200ms 폴백이 처리한다.
    const responseStream = await ai.models.generateContentStream({
      model: LEAN_E_MODEL_ID,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction,
        maxOutputTokens: REACTION_LEAN_MAX_OUTPUT_TOKENS,
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    let tokenIn = 0;
    let tokenOut = 0;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let errored = false;
        try {
          for await (const chunk of responseStream) {
            if (chunk.text) {
              controller.enqueue(encoder.encode(chunk.text));
            }
            if (chunk.usageMetadata) {
              tokenIn = chunk.usageMetadata.promptTokenCount ?? tokenIn;
              tokenOut = chunk.usageMetadata.candidatesTokenCount ?? tokenOut;
            }
          }
        } catch (e) {
          errored = true;
          controller.error(e);
        } finally {
          // controller.error()를 이미 호출했으면 컨트롤러가 errored 상태라 close()를 또 부르면
          // "Invalid state" 예외가 난다 — 에러 경로에서는 close()를 호출하지 않는다.
          if (!errored) controller.close();
        }
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
