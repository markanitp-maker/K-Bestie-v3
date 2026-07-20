import { pickReaction } from "@/lib/freeChatReactions";
import { GoogleGenAI } from "@google/genai";

export type AnswerClassification =
  | "VALID"
  | "PARTIAL"
  | "REFUSAL"
  | "NO_RESPONSE"
  | "SAFETY_SIGNAL";

function extractJSON(text: string) {
  try {
    const cleanText = text.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(cleanText);
  } catch {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {}
    }
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        return JSON.parse(arrMatch[0]);
      } catch {}
    }
    console.error("[answer-classifier] JSON 추출 실패. 원문(300자):", text.substring(0, 300));
    throw new Error("JSON 파싱 오류");
  }
}

async function generateWithRetry(prompt: string): Promise<string> {
  const apiKey = process.env.GEMMA_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMMA_API_KEY is not configured");
  }
  const ai = new GoogleGenAI({ apiKey });
  const delays = [0, 2000];
  const PER_ATTEMPT_TIMEOUT_MS = 15000;
  let lastError: any;

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model: "gemma-4-31b-it",
          contents: prompt,
          config: {
            systemInstruction:
              "반드시 JSON 형식으로만 응답해야 합니다. Markdown 코드 블록 등 외에 어떠한 텍스트도 추가하지 마십시오.",
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`generateContent timeout after ${PER_ATTEMPT_TIMEOUT_MS}ms`)), PER_ATTEMPT_TIMEOUT_MS)
        ),
      ]);
      if (response.text) {
        return response.text;
      }
      throw new Error("Empty response from model");
    } catch (err: any) {
      lastError = err;
      console.error(`[answer-classifier] Attempt ${attempt + 1} failed:`, err.message || err);
    }
  }
  throw lastError || new Error("Failed to generate content after retries");
}

/**
 * 아이의 답변을 분석하여 VALID/PARTIAL/REFUSAL/NO_RESPONSE/SAFETY_SIGNAL 중 하나로 분류한다.
 */
export async function classifyAnswer(
  questionText: string,
  answerText: string
): Promise<AnswerClassification> {
  // 1. SAFETY_SIGNAL 검사 (기존 안전 감지 로직 재사용)
  const reaction = pickReaction(answerText);
  if (reaction.category === "safety" || reaction.flaggedForParent) {
    return "SAFETY_SIGNAL";
  }

  // 2. NO_RESPONSE 검사 (비어있거나 타임아웃 신호)
  const trimmed = (answerText ?? "").trim();
  const isTimeout =
    trimmed === "" ||
    trimmed === "TIMEOUT" ||
    trimmed.toLowerCase() === "no_response" ||
    trimmed.toLowerCase() === "timeout";
  if (isTimeout) {
    return "NO_RESPONSE";
  }

  // 3. REFUSAL 검사 (회피 표현 키워드가 답변의 전부이거나 답변이 매우 짧고 이 표현을 포함하는 경우)
  const refusalKeywords = [
    "몰라",
    "그냥",
    "없어",
    "비밀이야",
    "비밀",
    "말하기싫어",
    "말하기 싫어",
    "기억안나",
    "기억 안나",
    "귀찮아",
    "싫어",
    "안할래",
    "안 할래",
    "하기싫어",
    "하기 싫어",
    "대답안할래",
    "대답 안 할래",
    "기억이 안 나",
    "기억이안나",
    "글쎄",
    "노코멘트",
    "대답안",
    "대답 안",
    "패스",
    "스킵",
  ];
  const cleanText = trimmed.replace(/[\s.!?~…]/g, "");
  const isEvasive = refusalKeywords.some((kw) => {
    const cleanKw = kw.replace(/\s/g, "");
    return cleanText === cleanKw || (cleanText.includes(cleanKw) && trimmed.length <= 10);
  });
  if (isEvasive) {
    return "REFUSAL";
  }

  // 4. VALID / PARTIAL 검사 (Gemma-4-31b-it 호출)
  const prompt = `질문: ${JSON.stringify(questionText)}
아이의 답변: ${JSON.stringify(answerText)}

위 질문에 대한 아이의 답변을 분석하여 다음 기준에 따라 VALID 또는 PARTIAL로 분류해주세요.

- VALID: 답변에 사람, 장소, 사건, 구체적 사물/음식/활동, 구체적 감정 단어 등 질문의 주제와 직결되는 구체적인 내용적 요소가 하나 이상 포함되어 있는 경우. (예: "스파게티"는 구체적 음식이므로 VALID)
- PARTIAL: 질문의 주제와 관련은 있으나, 구체적인 요소가 결여되어 있고 추상적이거나 모호하게 대답한 경우. (예: "그냥 다 맛있어", "다 좋아" 등)

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명이나 텍스트는 절대 포함하지 마십시오.

{
  "classification": "VALID" | "PARTIAL",
  "reason": "분류 이유 요약"
}
`;

  try {
    const rawResult = await generateWithRetry(prompt);
    const parsed = extractJSON(rawResult);
    if (parsed.classification === "VALID" || parsed.classification === "PARTIAL") {
      return parsed.classification;
    }
    return "PARTIAL"; // 기본 폴백
  } catch (err) {
    console.error("[answer-classifier] Gemma 분류 실패, PARTIAL로 폴백:", err);
    return "PARTIAL";
  }
}
