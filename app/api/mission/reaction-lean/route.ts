import { NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveChildForUser } from "@/lib/child/testAccount";
import { createGenAIClient, LEAN_E_MODEL_ID, REACTION_LEAN_MAX_OUTPUT_TOKENS } from "@/app/api/_lib/ai";
import { after } from "next/server";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";

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

    // 인증/테스트계정 확인(DB 왕복 2~3회)과 Gemini 호출을 순차가 아니라 병렬로 시작한다 —
    // 인증 체크가 느려도 모델의 첫 토큰 생성 시작이 그만큼 늦어지지 않게 하기 위함(실측상
    // 이 부분이 순차일 때 child_bubble_rendered→llm_first_token이 1.3~2.3초까지 늘어났다).
    // 스트림은 인증 결과가 확정된 뒤에만 클라이언트로 내보낸다 — 미인증 사용자에게 생성 결과가
    // 새어나가지 않는다.
    const authCheckPromise = (async (): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { ok: false, status: 401 };
      const svc = createServiceClient();
      const child = await resolveChildForUser(svc, user.id);
      if (!child) return { ok: false, status: 403 };
      return { ok: true };
    })();

    const ai = createGenAIClient({ provider: "vertex" });

    // LLM 호출은 정확히 1회만 시도한다(요구사항 — 실패 시 같은 모델로도 재시도하지 않음).
    // await하지 않고 Promise만 먼저 만들어 인증 체크와 동시에 진행되게 한다.
    const streamPromise = ai.models.generateContentStream({
      model: LEAN_E_MODEL_ID,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction,
        maxOutputTokens: REACTION_LEAN_MAX_OUTPUT_TOKENS,
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    // 인증 실패로 이 Promise를 버릴 수도 있으므로, 그 경우에도 unhandled rejection이 나지 않게
    // 미리 안전하게 소비해둔다.
    streamPromise.catch(() => {});

    // 인증 결과를 먼저 확인한다 — 인증에 실패하면 Gemini 호출 결과와 무관하게 즉시 401/403을
    // 반환한다(느린 쪽을 기다리지 않고, 실패 사유도 정확하게 유지된다).
    const authResult = await authCheckPromise;
    if (!authResult.ok) {
      return new Response(authResult.status === 401 ? "Unauthorized" : "Forbidden", { status: authResult.status });
    }

    // 인증을 통과한 뒤에야 실제로 스트림 생성 결과를 기다린다 — 여기서 실패하면 진짜 500.
    const responseStream = await streamPromise;

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
