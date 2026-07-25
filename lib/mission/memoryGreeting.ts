// requests/011 — "A안" (2026-07-26 대표님 확정): 자유대화 구조는 규칙 기반 그대로 유지하고,
// 대화 종료 후 이미 생성되는 요약 기억(child_memory, supabase/functions/_shared/batch.ts의
// generateMemorySummaries)을 다음 대화(미션 세션 시작 인사말)의 context에 주입한다.
//
// 새 요약 생성 파이프라인을 만들지 않는다 — child_memory는 이미 memory-batch(18:00/23:59 KST)가
// 채우고 있으므로, 여기서는 "주입" 부분만 구현한다: 세션 시작 시 최근 기억을 조회해 연결성이
// 높을 때만 짧게 개인화된 인사말을 생성하고, 그렇지 않으면 null을 반환해 기존 템플릿 인사말로
// 자연스럽게 폴백시킨다.

import { SupabaseClient } from "@supabase/supabase-js";
import { createGenAIClient, LEAN_E_MODEL_ID } from "@/app/api/_lib/ai";

export async function buildMemoryGreeting(
  db: SupabaseClient,
  childId: string,
  givenNameVocative: string | null
): Promise<string | null> {
  try {
    const nowIso = new Date().toISOString();

    const [longTermSettled, shortTermSettled] = await Promise.allSettled([
      db
        .from("child_memory")
        .select("category, content, business_date")
        .eq("child_id", childId)
        .eq("memory_type", "long_term")
        .order("business_date", { ascending: false })
        .limit(10),
      db
        .from("child_memory")
        .select("category, content, business_date")
        .eq("child_id", childId)
        .eq("memory_type", "short_term")
        .gt("expires_at", nowIso)
        .order("business_date", { ascending: false })
        .limit(5),
    ]);

    if (longTermSettled.status === "rejected" || shortTermSettled.status === "rejected") {
      return null;
    }
    if (longTermSettled.value.error || shortTermSettled.value.error) {
      console.error(
        "[memoryGreeting] child_memory 조회 실패:",
        longTermSettled.value.error || shortTermSettled.value.error
      );
      return null;
    }

    const memories = [...(shortTermSettled.value.data ?? []), ...(longTermSettled.value.data ?? [])];
    if (memories.length === 0) return null;

    const memoryText = memories
      .map((m) => `[${m.business_date}] ${m.category ? `(${m.category}) ` : ""}${m.content}`)
      .join("\n");

    const systemInstruction = `너는 아이의 친근한 AI 친구 케이야. 아래 '최근 기억'을 참고해서, 아이와의 대화를 시작하는 짧은 인사말을 만들지 판단해라.

[최근 기억]
${memoryText}

규칙(반드시 지켜라):
1. 기억 목록에 없는 내용은 절대 지어내지 마라(할루시네이션 금지). 감정/친구관계/사건을 임의로 추론하지 마라.
2. 기억과의 연결성이 명확하고 자연스러울 때만 인사말에 반영해라. 애매하거나 억지스러우면 그냥 안 쓰는 게 낫다.
3. 매번 기억을 억지로 꺼내지 마라 - 관련성이 부족하면 반영하지 않는 것이 기본값이다.
4. 부담스럽거나 꼬치꼬치 캐묻는 듯한 표현은 금지한다(예: 반드시 대답을 요구하는 듯한 표현).
5. 인사말은 한국어 1문장, 40자 이내, 반말, 따뜻하고 친근한 톤.
6. 이름을 부를 때는 "${givenNameVocative ?? "너"}"를 그대로 사용해라(성 없이 이미 호격 처리된 형태).

출력은 반드시 아래 JSON 형식 그대로:
{"use_memory": true 또는 false, "greeting": "인사말 또는 빈 문자열"}`;

    const ai = createGenAIClient({ provider: "vertex" });
    const response = await ai.models.generateContent({
      model: LEAN_E_MODEL_ID,
      contents: "위 규칙에 따라 인사말 사용 여부와 인사말을 JSON으로 출력해.",
      config: {
        systemInstruction,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.3,
        maxOutputTokens: 120,
      },
    });

    const text = response.text?.trim();
    if (!text) return null;

    let parsed: { use_memory?: boolean; greeting?: string };
    try {
      const cleanText = text.replace(/```json\n?|```\n?/g, "").trim();
      parsed = JSON.parse(cleanText);
    } catch {
      return null;
    }

    if (!parsed.use_memory || typeof parsed.greeting !== "string") return null;
    const greeting = parsed.greeting.trim();
    if (!greeting || greeting.length > 60) return null;

    return greeting;
  } catch (err) {
    console.error("[memoryGreeting] 예외 발생(기본 인사말로 폴백):", err);
    return null;
  }
}
