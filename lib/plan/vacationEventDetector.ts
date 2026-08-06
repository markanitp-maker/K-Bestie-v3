import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";

export type VacationEventType = 
  | "VACATION_DECLARED" 
  | "SCHOOL_START_DATE_UNKNOWN" 
  | "SCHOOL_START_DATE_PROVIDED" 
  | "SCHOOL_START_CONFIRMED" 
  | "SCHOOL_START_POSTPONED" 
  | "NONE";

export interface VacationEventResult {
  eventType: VacationEventType;
  schoolStartDate: string | null;
  needsFollowUpForAmbiguousDate: boolean;
}

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
    console.error("[vacationEventDetector] JSON 추출 실패. 원문(300자):", text.substring(0, 300));
    throw new Error("JSON 파싱 오류");
  }
}

async function generateWithRetry(prompt: string): Promise<string> {
  const modelConfig = await getModelForGroup("B");
  const ai = createGenAIClient(modelConfig);
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
          model: getLlmModel("vacationEventDetection"),
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            systemInstruction:
              "반드시 JSON 형식으로만 응답해야 합니다. Markdown 코드 블록 등 외에 어떠한 텍스트도 추가하지 마십시오.",
            responseSchema: {
              type: "OBJECT",
              properties: {
                eventType: { 
                  type: "STRING", 
                  enum: [
                    "VACATION_DECLARED", 
                    "SCHOOL_START_DATE_UNKNOWN", 
                    "SCHOOL_START_DATE_PROVIDED", 
                    "SCHOOL_START_CONFIRMED", 
                    "SCHOOL_START_POSTPONED", 
                    "NONE"
                  ] 
                },
                schoolStartDate: { type: "STRING" },
                needsFollowUpForAmbiguousDate: { type: "BOOLEAN" }
              },
              required: ["eventType", "needsFollowUpForAmbiguousDate"]
            },
            maxOutputTokens: 1024,
            thinkingConfig: { thinkingLevel: 'LOW' as any }
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
      console.error(`[vacationEventDetector] Attempt ${attempt + 1} failed:`, err.message || err);
    }
  }
  throw lastError || new Error("Failed to generate content after retries");
}

export async function detectVacationEvent(
  childUtterance: string,
  businessDateKST: string,
  recentContext?: string
): Promise<VacationEventResult> {
  const prompt = `오늘 날짜(KST 기준): ${businessDateKST}
아이의 발화: "${childUtterance}"
최근 문맥: "${recentContext || '없음'}"

이 발화를 분석하여 방학 또는 개학과 관련된 이벤트인지 확인하고, 해당된다면 이벤트 타입을 반환하세요.

이벤트 타입 정의:
- VACATION_DECLARED: 아이가 현재 방학 중이거나 학교에 안 간다고 선언한 경우 ("방학이야", "학교 안 가", "여름방학이야")
- SCHOOL_START_DATE_UNKNOWN: 개학 날짜를 물어봤을 때 아이가 모른다고 대답한 경우 ("잘 모르겠어", "기억 안 나")
- SCHOOL_START_DATE_PROVIDED: 아이가 개학 날짜를 알려준 경우 ("8월 20일", "다음 주 월요일", "이번 달 말")
- SCHOOL_START_CONFIRMED: 개학일 당일이나 이후에 아이가 학교에 갔다고 확인한 경우 ("오늘 개학했어", "학교 다녀왔어")
- SCHOOL_START_POSTPONED: 개학이 미뤄졌다고 말하는 경우 ("개학 미뤄졌어")
- NONE: 위 중 아무것도 해당하지 않는 경우

날짜 제공(SCHOOL_START_DATE_PROVIDED)이거나 연기(SCHOOL_START_POSTPONED)된 날짜가 포함되어 있을 경우:
- '오늘 날짜'를 기준으로 절대 날짜(YYYY-MM-DD 형식)를 계산해서 schoolStartDate에 반환하세요.
- "다음 주", "이번 달 말" 같이 날짜를 정확한 YYYY-MM-DD로 특정하기 모호하다면, 계산된 예상 날짜를 schoolStartDate에 넣고, needsFollowUpForAmbiguousDate를 true로 설정하세요. 확실한 날짜(예: "8월 20일")라면 false로 설정하세요.

응답 형식은 반드시 아래 JSON을 따르세요:
{
  "eventType": "이벤트 타입",
  "schoolStartDate": "YYYY-MM-DD 또는 null",
  "needsFollowUpForAmbiguousDate": true/false
}
`;

  try {
    const rawResult = await generateWithRetry(prompt);
    const parsed = extractJSON(rawResult);
    
    return {
      eventType: parsed.eventType || "NONE",
      schoolStartDate: parsed.schoolStartDate || null,
      needsFollowUpForAmbiguousDate: !!parsed.needsFollowUpForAmbiguousDate
    };
  } catch (err) {
    console.error("[vacationEventDetector] failed, fallback to NONE:", err);
    return {
      eventType: "NONE",
      schoolStartDate: null,
      needsFollowUpForAmbiguousDate: false
    };
  }
}
