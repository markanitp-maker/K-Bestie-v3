import type { UtteranceSignals } from "../utteranceSignals";
import type { NonsenseQuestionRow } from "./nonsenseQuizTypes";

export type ChildNonsenseIntent =
  | "STOP"
  | "TOPIC_SHIFT"
  | "REVEAL_ANSWER"
  | "REQUEST_HINT"
  | "NEXT_QUESTION"
  | "ANSWER_ATTEMPT";

/**
 * 넌센스 퀴즈 답변 텍스트 정규화.
 * 공백, 문장부호, 접두사("정답: "), 서술어/종결어미("~야", "~예요", "~인가")를 제거합니다.
 */
export function normalizeNonsenseAnswer(text: string): string {
  if (!text || typeof text !== "string") return "";

  let cleaned = text.trim();

  // 1. 접두사 제거 ("정답은", "답:", "혹시")
  cleaned = cleaned.replace(/^(?:정답(?:은|이)?|답(?:은|이)?|혹시)\s*[:=!]?\s*/, "");

  // 2. 앞뒤 문장부호 및 특수문자 제거
  cleaned = cleaned.replace(/^[\s!?.~^,;:…]+|[\s!?.~^,;:…]+$/g, "");

  // 3. 서술격 조사 / 종결어미 제거
  cleaned = cleaned.replace(
    /(?:이야|야|이다|이에요|예요|입니다|이지|잖아|인가요|인가|인듯|인\s*것\s*같아|인것같아|같아)$/,
    ""
  );

  // 4. 모든 내부 공백 제거 (넌센스 퀴즈는 띄어쓰기 차이로 오답 처리하지 않음)
  cleaned = cleaned.replace(/\s+/g, "");

  return cleaned.trim();
}

/** 명시적 게임 중단 발화 패턴 */
const EXPLICIT_STOP_PATTERNS = [
  /(?:넌센스|수수께끼|퀴즈|게임|놀이)?\s*(?:그만|안\s*할래|안해|그만하자|그만할래|그만해|끝낼래|안\s*놀래|하기\s*싫어)/,
  /^(?:그만|그만해|끝|안해|안\s*해|싫어|안\s*놀래)$/,
];

/** 다음 문제 요청 패턴 */
const NEXT_QUESTION_PATTERNS = [
  /^(?:다음|또|하나\s*더|한\s*번\s*더|한번\s*더|계속|다음\s*문제|문제\s*더|더\s*해|더\s*할래|더\s*하자)$/,
  /(?:다음\s*문제|문제\s*또|문제\s*하나\s*더|새\s*문제|다른\s*문제|하나\s*더\s*내|또\s*내)/,
  /^(?:다음\s*다음\s*문제\s*또\s*내라고|다음\s*문제\s*내줘|다음\s*문제\s*줘|또\s*내봐|또\s*내줘|문제\s*내봐|문제\s*내줘)$/,
];

/** 정답 바로 공개 / 포기 요청 패턴 */
const REVEAL_ANSWER_PATTERNS = [
  /(?:정답|답)\s*(?:알려줘|알려\s*줘|공개|뭐야|뭔데|말해줘|말해\s*줘|보여줘|알려줄래)/,
  /(?:모르겠어|몰라)\s*(?:정답|답)\s*(?:알려줘|뭐야|뭔데)/,
  /^(?:정답|답)$/,
  /^(?:포기|패스|항복|포기할래|항복할래|패스할래)$/,
];

/** 힌트 요청 키워드 및 부정어 */
const HINT_REQUEST_KWS = [
  "힌트", "모르겠", "몰라", "어려워", "어렵", "못 맞추겠", "못 맞히겠", "도저히 모르", "하나도 모르", "잘 모르"
];
const HINT_NEGATION_KWS = [
  "힌트 필요 없어", "힌트 필요없어", "힌트 주지 마", "힌트 주지마", "힌트 안", "없이"
];

/** 일상 대화 / 서술어 종결어미 패턴 (Topic Shift 감지용) */
const TOPIC_SHIFT_VERB_ENDINGS = [
  "했어", "했지", "했다", "할래", "먹었어", "갔어", "봤어", "인데", "거든", "잖아", "같아",
  "어때", "있어", "없어", "귀찮아", "힘들어", "뭐해", "언제 가", "어디 가", "싸웠어", "혼났어"
];

/**
 * 아이의 발화 의도를 결정론적으로 분류합니다 (§3-9, §3-15).
 */
export function classifyChildNonsenseUtterance(
  utterance: string,
  signals?: UtteranceSignals
): ChildNonsenseIntent {
  const trimmed = utterance.trim();

  // 1. 감정 / 갈등 / 안전 / 신체적 불편 신호 -> Topic Shift 최우선 (§3-15)
  if (
    signals?.hasNegativeEmotion ||
    signals?.hasConflict ||
    signals?.hasPhysicalNeed
  ) {
    return "TOPIC_SHIFT";
  }

  // 2. 명시적 중단 요청
  if (signals?.hasPlayStop || EXPLICIT_STOP_PATTERNS.some((p) => p.test(trimmed))) {
    return "STOP";
  }

  // 3. 다음 문제 요청
  if (NEXT_QUESTION_PATTERNS.some((p) => p.test(trimmed))) {
    return "NEXT_QUESTION";
  }

  // 4. 정답 바로 공개 요청
  if (REVEAL_ANSWER_PATTERNS.some((p) => p.test(trimmed))) {
    return "REVEAL_ANSWER";
  }

  // 5. 힌트 요청
  const hasHintKw = HINT_REQUEST_KWS.some((kw) => trimmed.includes(kw));
  const hasHintNeg = HINT_NEGATION_KWS.some((kw) => trimmed.includes(kw));
  if (hasHintKw && !hasHintNeg) {
    return "REQUEST_HINT";
  }

  // 6. 일반 지식 질문 / 기억 회상 질의 -> Topic Shift
  if (signals?.hasGeneralKnowledgeQuestion || signals?.hasMemoryRecallQuery) {
    return "TOPIC_SHIFT";
  }

  // 7. 긴 일상 서술문 (띄어쓰기 포함 7자 이상이면서 서술어 어미로 끝나는 경우)
  if (trimmed.includes(" ") && trimmed.length >= 7) {
    if (TOPIC_SHIFT_VERB_ENDINGS.some((ending) => trimmed.endsWith(ending) || trimmed.includes(ending))) {
      return "TOPIC_SHIFT";
    }
  }

  return "ANSWER_ATTEMPT";
}

export interface ValidationResult {
  isCorrect: boolean;
  normalizedChildAnswer: string;
  matchedAnswer?: string;
}

/**
 * 아이의 답변이 문제의 canonical_answer 또는 accepted_answers와 일치하는지 결정론적으로 판정합니다 (§3-9).
 * Gemini의 자의적 판단으로 정답/오답을 뒤집지 않습니다.
 */
export function validateNonsenseAnswer(
  childUtterance: string,
  question: NonsenseQuestionRow
): ValidationResult {
  const normalizedChild = normalizeNonsenseAnswer(childUtterance);
  if (!normalizedChild) {
    return {
      isCorrect: false,
      normalizedChildAnswer: "",
    };
  }

  const rawChild = childUtterance.trim().replace(/[\s!?.~^,;:…]+/g, "");

  // 1. canonical_answer 대조 (정규화 및 원문 공백제거 비교)
  const canonicalNorm = normalizeNonsenseAnswer(question.canonical_answer);
  const canonicalRaw = question.canonical_answer.trim().replace(/[\s!?.~^,;:…]+/g, "");

  if (
    normalizedChild === canonicalNorm ||
    rawChild === canonicalRaw ||
    normalizedChild === canonicalRaw ||
    rawChild === canonicalNorm
  ) {
    return {
      isCorrect: true,
      normalizedChildAnswer: normalizedChild,
      matchedAnswer: question.canonical_answer,
    };
  }

  // 2. accepted_answers 목록 대조
  const acceptedList = Array.isArray(question.accepted_answers)
    ? question.accepted_answers
    : [];

  for (const accepted of acceptedList) {
    const acceptedNorm = normalizeNonsenseAnswer(accepted);
    const acceptedRaw = accepted.trim().replace(/[\s!?.~^,;:…]+/g, "");

    if (
      normalizedChild === acceptedNorm ||
      rawChild === acceptedRaw ||
      normalizedChild === acceptedRaw ||
      rawChild === acceptedNorm
    ) {
      return {
        isCorrect: true,
        normalizedChildAnswer: normalizedChild,
        matchedAnswer: accepted,
      };
    }
  }

  return {
    isCorrect: false,
    normalizedChildAnswer: normalizedChild,
  };
}
