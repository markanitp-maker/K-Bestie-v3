// requests/024-parent-guide-question-separation.md §7 출력 검증
// 순수 TS, 외부 import 없음(reportSafetyGuard.ts와 동일 원칙 — Next.js 배치 경로와
// Supabase Edge Function 양쪽에서 동일하게 재사용 가능해야 하므로 Next 전용 import 금지).
//
// LLM이 규칙(질문 아님/의문문 2~3개/서로 중복 없음)을 어길 가능성에 대비한 서버측
// 마지막 검증 게이트 — 실패한 필드는 null 또는 빈 배열로 저장하고(정상값처럼 위장 금지),
// 호출부가 1회 재생성을 시도할 수 있도록 순수 함수로만 제공한다.

const MIN_QUESTIONS = 2;
const MAX_QUESTIONS = 3;

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** 문장 끝의 종결부호(.?!？) 차이는 중복 판정에서 무시한다 — clue는 "."로,
 *  question은 "?"로 끝나는 게 정상이라 부호만 다르고 본문이 동일한 경우가 흔하다. */
function stripTrailingPunctuation(s: string): string {
  return s.replace(/[.?!？]+$/u, "");
}

/** 두 문장이 사실상 같은 내용인지(완전 일치 또는 한쪽이 다른 쪽을 대부분 포함) 판정 */
function isNearDuplicate(a: string, b: string): boolean {
  const na = stripTrailingPunctuation(normalize(a));
  const nb = stripTrailingPunctuation(normalize(b));
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  return longer.includes(shorter) && shorter.length >= longer.length * 0.6;
}

/** 부모 대화 실마리 검증 — 문자열 또는 null, 빈 문자열 금지, 질문 아님, 추천 질문과 중복 아님 */
export function validateParentConversationClue(value: unknown, questions: string[]): string | null {
  if (typeof value !== "string") return null;
  const clue = normalize(value);
  if (!clue) return null;
  if (clue.includes("?") || clue.includes("？")) return null;
  for (const q of questions) {
    if (isNearDuplicate(clue, q)) return null;
  }
  return clue;
}

/** 부모용 추천 질문 검증 — 배열, 길이 2~3, 각 항목 의문문, 서로 중복 없음, 실마리와 중복 아님.
 *  기준 미달(2개 미만)이면 전체를 빈 배열로 처리한다(완전 실패로 간주 — §7 "실패한 필드"). */
export function validateRecommendedQuestions(value: unknown, clue: string | null): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const q = normalize(raw);
    if (!q) continue;
    if (!(q.endsWith("?") || q.endsWith("？"))) continue;
    if (clue && isNearDuplicate(q, clue)) continue;
    if (result.some((s) => isNearDuplicate(s, q))) continue;
    result.push(q);
    if (result.length >= MAX_QUESTIONS) break;
  }
  if (result.length < MIN_QUESTIONS) return [];
  return result;
}

export interface ParentGuideValidationResult {
  clue: string | null;
  questions: string[];
}

/** clue/questions를 함께 검증한다(서로 참조하는 중복 검사를 위해 2-pass로 계산). */
export function validateParentGuideOutput(rawClue: unknown, rawQuestions: unknown): ParentGuideValidationResult {
  const questionsBeforeClueCheck = validateRecommendedQuestions(rawQuestions, null);
  const clue = validateParentConversationClue(rawClue, questionsBeforeClueCheck);
  const questions = validateRecommendedQuestions(rawQuestions, clue);
  return { clue, questions };
}

const RETRY_PROMPT_TEMPLATE = (transcriptText: string) => `다음은 아이와 AI 친구 케이의 대화 원문입니다.

${transcriptText}

이 대화를 근거로 JSON을 생성하세요.
{
  "parent_conversation_clue": "부모가 아이와 대화를 시작하기 전 알아야 할 맥락과 접근 태도(2~4문장, 질문 금지)",
  "recommended_questions": ["부모가 아이에게 그대로 물을 수 있는 자연스러운 의문문 2~3개, 각각 물음표로 끝날 것"]
}`;

/** requests/024 §7 "실패한 필드만 한 번 재생성" — 1차 생성에서 검증 실패(null/빈 배열)한
 *  필드만 같은 대화록을 근거로 딱 1회 재생성한다. 재생성도 실패하면 그대로 null/빈 배열로
 *  확정한다(정상값처럼 위장하지 않음). dailyReportV3.ts/generateWeeklySummary.ts가 공유. */
export async function retryParentGuideIfNeeded(
  transcriptText: string,
  current: ParentGuideValidationResult,
  ai: any,
  model: string
): Promise<ParentGuideValidationResult> {
  if (current.clue !== null && current.questions.length > 0) return current;

  try {
    const retryResult = await ai.models.generateContent({
      model,
      contents: RETRY_PROMPT_TEMPLATE(transcriptText),
      config: {
        responseSchema: {
          type: "OBJECT",
          properties: {
            parent_conversation_clue: { type: "STRING" },
            recommended_questions: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["parent_conversation_clue", "recommended_questions"],
        },
        responseMimeType: "application/json",
        maxOutputTokens: 1024,
      },
    });
    const text = (retryResult.text ?? "{}").trim();
    const parsed = JSON.parse(text);
    const retried = validateParentGuideOutput(parsed?.parent_conversation_clue, parsed?.recommended_questions);
    return {
      clue: current.clue !== null ? current.clue : retried.clue,
      questions: current.questions.length > 0 ? current.questions : retried.questions,
    };
  } catch (e: any) {
    console.error("[parentGuideValidation] 재생성 실패 — null/빈 배열로 확정", e?.message ?? e);
    return current;
  }
}
