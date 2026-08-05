import { extractJSON } from "@/app/api/_lib/utils";

// requests/request-parent-question-feature.md §6 "아이 답변 재확인 절차"
//
// 부모 질문에 아이가 1차로 답한 내용을 곧바로 confirmed로 확정하지 않고, 반드시
// "내가 잘 이해했는지 확인할게. ~가 맞아?" 재확인 질문을 한 번 더 거친 뒤에만 확정한다
// (STT 오인식·긍정부정 반전·이름/장소 오류 방지가 목적, §6.1).
//
// 재확인 질문은 LLM을 새로 호출하지 않고 결정적 템플릿으로 생성한다 — 안전에 민감한
// 문구를 매 턴 LLM에 맡기면 표현이 흔들리거나 원문 의미가 왜곡될 위험이 있어, 아이가
// 실제로 말한 내용을 그대로 되짚어 묻는 고정 템플릿이 더 안전하고 예측 가능하다.

export function buildConfirmationQuestion(rawAnswerText: string): string {
  const trimmed = rawAnswerText.trim();
  return `내가 잘 이해했는지 확인할게. "${trimmed}"가 맞아?`;
}

export type ConfirmationVerdict = "yes" | "no";

const YES_PATTERNS = [
  /^응+[.!~,\s]*$/,
  /^네+[.!~,\s]*$/,
  /^넵+[.!~,\s]*$/,
  /^어+[.!~,\s]*$/,
  /^맞아+[.!~,\s]*$/,
  /^맞어+[.!~,\s]*$/,
  /^맞습니다[.!~,\s]*$/,
  /^그래+[.!~,\s]*$/,
  /^(응|네|어|맞아|맞어|맞습니다|그래)[,.\s]+맞아/,
  /^yes$/i,
];

// 재확인 질문에 대한 아이의 응답을 판정한다. 명확한 긍정 패턴이 아니면 전부 "no"로
// 취급한다(§6.2 "명확히 확인되지 않으면 부모에게 추측 답변을 전달하지 않는다" — 애매하면
// 보수적으로 재확인을 한 번 더 거치는 쪽이 안전하다).
export function classifyConfirmationAnswer(answerText: string): ConfirmationVerdict {
  const trimmed = answerText.trim();
  if (!trimmed) return "no";
  for (const pattern of YES_PATTERNS) {
    if (pattern.test(trimmed)) return "yes";
  }
  return "no";
}

// §10 보안 원칙 "대화 원문 직접 노출 금지" — 아이가 재확인까지 마친 답변이라도 부모
// 화면에는 아이가 말한 문장을 그대로 옮기지 않고, 3인칭 요약("~라고 확인했어요")으로
// 순화해서 보여준다. 실패하면(LLM 오류 등) 원문을 그대로 노출하는 대신 안전한 일반
// 문구로 대체한다 — "표시할 내용이 없다"가 "원문 그대로 보여준다"보다 안전하다.
const FALLBACK_PARENT_ANSWER_SUMMARY = "아이가 질문에 답변했어요.";

export async function paraphraseAnswerForParent(
  ai: any,
  model: string,
  questionText: string,
  confirmedRawAnswer: string,
): Promise<string> {
  try {
    const result = await ai.models.generateContent({
      model,
      contents: `아래는 부모의 질문과, 아이가 재확인까지 마친 최종 답변입니다. 아이가 실제로 한 말을 그대로 옮기지 말고, 부모에게 전달할 자연스러운 3인칭 한 문장 요약으로 바꿔주세요(예: "지민이와 가장 친하다고 확인했어요").\n\n질문: ${questionText}\n아이의 확인된 답변: ${confirmedRawAnswer}`,
      config: {
        // 066-llm-wiki QA에서 실측: systemInstruction 없이 "JSON으로만 응답"을 user
        // 프롬프트 안에만 넣으면 이 모델이 "Here is the JSON requested:" 같은 설명
        // 문장을 앞에 덧붙이는 경우가 있었다(짧은 maxOutputTokens와 겹치면 JSON 자체가
        // 잘려 파싱 실패로 이어짐). systemInstruction으로 명시 금지하고 여유 토큰을 둔다.
        systemInstruction: "반드시 JSON 객체 형식으로만 응답하라. 설명 문장이나 코드펜스 없이 순수 JSON만 출력하라.",
        responseSchema: { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] },
        responseMimeType: "application/json",
        // 066-llm-wiki QA에서 실측: thinkingConfig 없이는 이 모델이 내부 사고 토큰을
        // maxOutputTokens 예산에서 함께 소비해, 512로 올려도 가시 출력 JSON이 중간에
        // 잘리는 사례가 있었다("주" 한 글자에서 끊김). 짧은 구조화 요약에는 사고가
        // 필요 없으므로 0으로 꺼서 예산 전체를 실제 출력에 쓴다(voice/respond.ts와
        // 동일 패턴).
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 256,
      },
    });
    const text = (result.text ?? "").trim();
    // 066-llm-wiki QA에서 실측: responseSchema+responseMimeType='application/json'을
    // 지정해도 이 모델이 가끔 순수 JSON 앞에 설명 문장을 덧붙여 반환해 raw JSON.parse가
    // 깨지는 사례가 있었다 — 코드펜스/설명문 유무와 무관하게 JSON 블록을 관대하게
    // 추출하는 기존 extractJSON(app/api/_lib/utils.ts, contextCorrectionV3.ts와 동일
    // 패턴)으로 교체한다.
    const parsed = extractJSON(text);
    const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
    return summary || FALLBACK_PARENT_ANSWER_SUMMARY;
  } catch (e) {
    console.error("[parentQuestionReconfirm] 부모 노출용 답변 요약 생성 실패 — 안전 문구로 대체", e);
    return FALLBACK_PARENT_ANSWER_SUMMARY;
  }
}

export interface ParentQuestionLifecycleInput {
  /** 현재 delivery(mission_confirming)가 재확인 턴이면 그 질문 문구, 원본 질문 턴이면 null. */
  confirmationQuestionText: string | null;
  missionConfirmAttempts: number;
  classification: string;
  answerText: string;
}

// app/api/mission/answer/route.ts의 세 호출부(정상 분류 경로 / 중복요청 복구 경로 /
// V1 레거시 경로)가 전부 동일한 규칙을 쓰도록 단일 함수로 뺐다 — 세 곳에 각자 로직을
// 복제하면 한쪽만 고치고 나머지가 어긋나는 회귀가 생기기 쉽다.
export function computeParentQuestionLifecycleUpdate(
  input: ParentQuestionLifecycleInput,
): Record<string, unknown> {
  const { confirmationQuestionText, missionConfirmAttempts, classification, answerText } = input;
  const isReconfirmTurn = !!confirmationQuestionText;
  const nowIso = new Date().toISOString();

  if (classification === "SAFETY_SIGNAL") {
    return {
      status: "declined",
      declined_at: nowIso,
      child_answer_summary: null,
      confirmation_question_text: null,
      mission_confirm_attempts: Math.min(2, missionConfirmAttempts + 1),
    };
  }

  if (isReconfirmTurn) {
    if (classification === "REFUSAL") {
      return { status: "declined", declined_at: nowIso, child_answer_summary: null, confirmation_question_text: null };
    }
    const verdict = classifyConfirmationAnswer(answerText);
    if (verdict === "yes") {
      return { status: "confirmed", confirmed_at: nowIso };
    }
    if (missionConfirmAttempts + 1 >= 2) {
      // §6.2 재확인 2회 소진 — 추측 답변을 부모에게 전달하지 않는다.
      return { status: "mission_incomplete", mission_confirm_attempts: 2, child_answer_summary: null, confirmation_question_text: null };
    }
    // 아이가 "아니야" 등으로 정정한 것으로 보고, 그 발화를 새 답변 후보 삼아 한 번 더 재확인한다.
    const newSummary = answerText.trim();
    return {
      status: "reconfirm_pending",
      mission_confirm_attempts: missionConfirmAttempts + 1,
      child_answer_summary: newSummary,
      confirmation_question_text: buildConfirmationQuestion(newSummary),
    };
  }

  // 원본 질문 턴 — VALID 답변이어도 곧바로 confirmed로 확정하지 않고 재확인 라운드로 넘긴다(§6.1).
  if (classification === "VALID") {
    const summary = answerText.trim();
    return {
      status: "reconfirm_pending",
      mission_confirm_attempts: 0,
      child_answer_summary: summary,
      confirmation_question_text: buildConfirmationQuestion(summary),
    };
  }

  return {
    status: classification === "REFUSAL" ? "declined" : "mission_incomplete",
    mission_confirm_attempts: Math.min(2, missionConfirmAttempts + 1),
    ...(classification === "REFUSAL" ? { declined_at: nowIso } : {}),
  };
}
