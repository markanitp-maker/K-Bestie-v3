// K Conversation Engine — Boredom Detection (071 §16).
// 단발 응답 하나로 트리거하지 않는다 — 최근 여러 턴의 패턴을 근거로 판단한다.
// 신호: 몰라/없어/그냥/또 이거야?/재미없어/패스/질문 그만해/짧은 비협조 응답 반복/topic dodge 반복.

import { normalizeSameSessionText } from "./memory/sameSession";

export type BoredomLevel = "none" | "rising" | "high";

export interface BoredomAssessment {
  level: BoredomLevel;
  signalCount: number;
  matchedTurns: number;
  /** 이번 턴 발화 자체가 명시적 거부인지(018 §3-7). 누적 level 과 별개다. */
  explicitRefusalThisTurn: boolean;
  /** Boredom 상승 시 Action Selector/Response Generator가 참고할 대응 방향(고정 문구 아님, 방향만). */
  suggestedAdjustment: {
    questionRateDown: boolean;
    stopSameTopic: boolean;
    increaseFunType: boolean;
    increaseChildChoice: boolean;
    allowTopicShift: boolean;
    allowEarlyFinish: boolean;
  } | null;
}

const BOREDOM_KEYWORDS = [
  "몰라", "모르겠", "없어", "없는데", "그냥", "패스", "재미없", "재미 없",
  "질문 그만", "그만 물어", "또 이거", "또이거", "안할래", "안 할래", "하기싫", "하기 싫",
  "귀찮", "그만할래", "그만 할래",
  "안 하고 싶", "안하고 싶", "안하고싶", "안 하고싶",
  "그만하고 싶", "그만하고싶", "그만 하고 싶", "그만 하고싶",
  "이거 싫", "이거싫", "이건 싫", "이건싫",
];

const EXPLICIT_REFUSAL_KEYWORDS = [
  "그만할래", "그만 할래",
  "그만하고 싶", "그만하고싶", "그만 하고 싶", "그만 하고싶",
  "그만해", "그만 해", "그만하자", "그만 하자",
  "질문 그만", "질문그만", "그만 물어", "그만물어",
  "안할래", "안 할래", "안할래요", "안 할래요",
  "하기싫", "하기 싫",
  "안 하고 싶", "안하고 싶", "안하고싶", "안 하고싶",
  "이거 싫", "이거싫", "이건 싫", "이건싫",
];

// codex-rv 2차 지적: "6자 이하면 전부 비협조"는 "응 좋아"/"학교 갔어"처럼 실제 내용이 있는
// 정상 답변까지 잡아낸다. 순수 무성의 필러(내용이 전혀 없는 감탄사류)만 정확히 매칭한다.
const PURE_FILLER_TOKENS = new Set(["어", "음", "네", "응", "아니", "어어", "음음", "그래", "몰루", "글쎄"]);

function stripPunctuation(text: string): string {
  return text.replace(/[.?!,~ㅋㅎ\s]/g, "");
}

/** 현재 턴의 발화가 명시적 거부(하기 싫다/그만하자는 의사 표시)인지 판정한다.
 * "몰라", "그냥", 순수 필러("응", "어")는 성의 없는 답일 뿐 거부가 아니므로 false다. */
export function isExplicitRefusal(text?: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (EXPLICIT_REFUSAL_KEYWORDS.some((kw) => trimmed.includes(kw))) return true;
  const stripped = stripPunctuation(trimmed);
  if (stripped.length > 0 && EXPLICIT_REFUSAL_KEYWORDS.some((kw) => stripped.includes(stripPunctuation(kw)))) {
    return true;
  }
  return false;
}

/** 한 턴이 "짧은 비협조 응답"인지 판단 — 키워드 매칭 + 내용이 전혀 없는 순수 필러 둘 다 포함.
 * "응 좋아"/"학교 갔어"처럼 짧아도 실질 내용이 있는 답은 비협조로 잡지 않는다. */
function isUncooperativeTurn(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (BOREDOM_KEYWORDS.some((kw) => trimmed.includes(kw))) return true;
  const stripped = stripPunctuation(trimmed);
  if (stripped.length > 0 && PURE_FILLER_TOKENS.has(stripped)) return true;
  return false;
}

const RISING_THRESHOLD = 2; // 최근 WINDOW턴 중 2턴 이상 비협조 → rising
const HIGH_THRESHOLD = 3; // 3턴 이상 → high
const WINDOW = 5;

/** same-session 조회에 현재 아이 발화가 이미 저장된 경우에도 한 번만 판정에 포함한다. */
export function buildBoredomUtterances(
  recentChildUtterances: string[],
  currentUtterance: string,
  currentUtteranceAlreadyInSession: boolean,
): string[] {
  const utterances = [...recentChildUtterances];
  if (currentUtteranceAlreadyInSession
    && normalizeSameSessionText(utterances.at(-1))
      === normalizeSameSessionText(currentUtterance)) {
    utterances.pop();
  }
  return [...utterances, normalizeSameSessionText(currentUtterance)];
}

/** 엔진이 판정한 값이 있으면 유지하고, 조기 반환 경로에서만 독립 판정을 사용한다. */
export async function resolveBoredomAssessment(
  engineBoredom: BoredomAssessment | undefined,
  computeIndependently: () => Promise<BoredomAssessment>,
): Promise<BoredomAssessment> {
  return engineBoredom ?? computeIndependently();
}

/** 최근 아이 발화(최신순 아님 — 오래된→최신 순으로 전달)를 근거로 다중턴 Boredom을 판단한다.
 * recentChildUtterances는 same-session tier에서 가져온 아이 발화만 넘긴다(K 발화 제외). */
export function assessBoredom(recentChildUtterances: string[]): BoredomAssessment {
  const window = recentChildUtterances.slice(-WINDOW);
  const uncooperativeTurns = window.filter(isUncooperativeTurn);
  const signalCount = uncooperativeTurns.length;
  const currentUtterance = recentChildUtterances.at(-1);
  const explicitRefusalThisTurn = isExplicitRefusal(currentUtterance);

  let level: BoredomLevel = "none";
  if (signalCount >= HIGH_THRESHOLD) level = "high";
  else if (signalCount >= RISING_THRESHOLD) level = "rising";

  if (level === "none") {
    return {
      level,
      signalCount,
      matchedTurns: window.length,
      explicitRefusalThisTurn,
      suggestedAdjustment: null,
    };
  }

  return {
    level,
    signalCount,
    matchedTurns: window.length,
    explicitRefusalThisTurn,
    suggestedAdjustment: {
      questionRateDown: true,
      stopSameTopic: true,
      increaseFunType: level === "high",
      increaseChildChoice: true,
      allowTopicShift: true,
      allowEarlyFinish: level === "high",
    },
  };
}
