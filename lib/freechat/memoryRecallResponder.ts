import { SupabaseClient } from "@supabase/supabase-js";
import { createGenAIClient, FREE_CHAT_MODEL_ID } from "@/app/api/_lib/ai";
import { searchMemoryFacts, formatMemoryFactsForPrompt } from "@/lib/memory/vectorRetrieval";

export async function generateMemoryRecallResponse(
  db: SupabaseClient,
  childId: string,
  childQuestion: string
): Promise<{ text: string; tokenIn: number; tokenOut: number } | null> {
  try {
    // 023 LLM Wiki(Step 6) — 아이 질문 자체를 쿼리로 벡터 검색을 먼저 시도한다.
    // 실패/결과 0건이면 기존 child_memory recency 조회로 그대로 fallback한다
    // (요청서 §8 "방식 제거하지 말고 fallback으로 유지").
    const vectorFacts = await searchMemoryFacts(db, childId, childQuestion, 5);
    let memoryText: string;

    if (vectorFacts) {
      memoryText = formatMemoryFactsForPrompt(vectorFacts);
    } else {
      const nowIso = new Date().toISOString();

      // 장기기억과 단기기억을 하나의 공유 limit으로 함께 조회하면, 최근 단기기억이 많을 때
      // business_date desc 정렬에 밀려 오래된(그러나 여전히 유효한) 장기기억이 잘려나갈 수 있다.
      // 장기기억은 "지속되는 정체성 정보"라 절대 밀려나면 안 되므로 별도 쿼리로 분리해서
      // 각자 자기 한도 안에서 안전하게 조회한다.
      const [longTermSettled, shortTermSettled] = await Promise.allSettled([
        db
          .from("child_memory")
          .select("memory_type, category, content, business_date")
          .eq("child_id", childId)
          .eq("memory_type", "long_term")
          .order("business_date", { ascending: false })
          .limit(30),
        db
          .from("child_memory")
          .select("memory_type, category, content, business_date")
          .eq("child_id", childId)
          .eq("memory_type", "short_term")
          .gt("expires_at", nowIso)
          .order("business_date", { ascending: false })
          .limit(10),
      ]);

      if (longTermSettled.status === "rejected") {
        console.error("[memoryRecallResponder] long_term query rejected:", longTermSettled.reason);
        return null;
      }
      if (shortTermSettled.status === "rejected") {
        console.error("[memoryRecallResponder] short_term query rejected:", shortTermSettled.reason);
        return null;
      }
      if (longTermSettled.value.error) {
        console.error("[memoryRecallResponder] long_term query error:", longTermSettled.value.error);
        return null;
      }
      if (shortTermSettled.value.error) {
        console.error("[memoryRecallResponder] short_term query error:", shortTermSettled.value.error);
        return null;
      }

      const memories = [...(longTermSettled.value.data ?? []), ...(shortTermSettled.value.data ?? [])];
      if (memories.length === 0) {
        return null;
      }

      memoryText = memories
        .map((m) => {
          const typeLabel = m.memory_type === "long_term" ? `장기기억-${m.category || "일반"}` : "단기기억";
          return `[${m.business_date}] (${typeLabel}): ${m.content}`;
        })
        .join("\n");
    }

    const systemInstruction = `너는 아이의 친근한 AI 친구야. 아이가 과거의 대화나 사실을 기억하냐고 물어봤어.
아래에 제공된 '기억 목록'을 바탕으로 아이의 질문에 대답해줘.

[기억 목록]
${memoryText}

규칙:
1. 기억 목록에 없는 내용은 절대 지어내지 마라(할루시네이션 금지). 목록에서 못 찾으면 정직하게 잘 기억이 안 난다고 답해라.
2. 답변은 한국어 1~2문장, 60자 이내로 짧게 작성하라.
3. 아이의 말투에 맞는 친근하고 다정한 톤(반말)으로 대답하라.`;

    const ai = createGenAIClient({ provider: "vertex" });
    const response = await ai.models.generateContent({
      model: FREE_CHAT_MODEL_ID,
      contents: childQuestion,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.1,
        maxOutputTokens: 60,
      },
    });

    const text = response.text?.trim();
    if (!text) {
      return null;
    }

    return {
      text,
      tokenIn: response.usageMetadata?.promptTokenCount ?? 0,
      tokenOut: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch (err) {
    console.error("[memoryRecallResponder] error:", err);
    return null;
  }
}
