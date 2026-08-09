// K Conversation Engine — Boredom Detection (071 §16).
// 단발 응답 하나로 트리거하지 않는다 — 최근 여러 턴의 패턴을 근거로 판단한다.
// 신호: 몰라/없어/그냥/또 이거야?/재미없어/패스/질문 그만해/짧은 비협조 응답 반복/topic dodge 반복.

export type BoredomLevel = "none" | "rising" | "high";

export interface BoredomAssessment {
  level: BoredomLevel;
  signalCount: number;
  matchedTurns: number;
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
];

// codex-rv 2차 지적: "6자 이하면 전부 비협조"는 "응 좋아"/"학교 갔어"처럼 실제 내용이 있는
// 정상 답변까지 잡아낸다. 순수 무성의 필러(내용이 전혀 없는 감탄사류)만 정확히 매칭한다.
const PURE_FILLER_TOKENS = new Set(["어", "음", "네", "응", "아니", "어어", "음음", "그래", "몰루", "글쎄"]);

function stripPunctuation(text: string): string {
  return text.replace(/[.?!,~ㅋㅎ\s]/g, "");
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

/** 최근 아이 발화(최신순 아님 — 오래된→최신 순으로 전달)를 근거로 다중턴 Boredom을 판단한다.
 * recentChildUtterances는 same-session tier에서 가져온 아이 발화만 넘긴다(K 발화 제외). */
export function assessBoredom(recentChildUtterances: string[]): BoredomAssessment {
  const window = recentChildUtterances.slice(-WINDOW);
  const uncooperativeTurns = window.filter(isUncooperativeTurn);
  const signalCount = uncooperativeTurns.length;

  let level: BoredomLevel = "none";
  if (signalCount >= HIGH_THRESHOLD) level = "high";
  else if (signalCount >= RISING_THRESHOLD) level = "rising";

  if (level === "none") {
    return { level, signalCount, matchedTurns: window.length, suggestedAdjustment: null };
  }

  return {
    level,
    signalCount,
    matchedTurns: window.length,
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
