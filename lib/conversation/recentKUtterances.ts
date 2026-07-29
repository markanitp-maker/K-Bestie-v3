// 048 hotfix: 미션/자유대화 화면의 1·2·3 타임라인은 화자별 채팅 로그가 아니라
// "케이가 실제로 말한 발화"만의 최근 3단계 타임라인이어야 한다. 기존에는 두 화면
// 모두 3번 영역(가장 약한 보조 문구)에 아이의 마지막 발화를 그대로 노출했다 —
// 케이 발화만 필터링한 뒤 최근 3개를 뽑는 이 로직을 한 곳에서 계산해 두 화면이
// 동일한 규칙을 공유하게 한다.

export interface ConversationTurnLike {
  role: "child" | "k";
  text: string;
}

export interface RecentKUtterances {
  current: string;
  previous: string;
  older: string;
}

/**
 * turns는 시간순(과거 → 현재) 정렬된 전체 대화 turn 목록이다. 현재 스트리밍 중인
 * 케이 발화도 role "k"로 같은 목록의 마지막 항목에 포함되어 있으면(각 화면의 기존
 * transcript/history 관례) 별도 처리 없이 그대로 "current"로 반영된다.
 */
export function getRecentKUtterances(turns: ConversationTurnLike[]): RecentKUtterances {
  const kTexts = turns.filter((t) => t.role === "k").map((t) => t.text);
  const n = kTexts.length;
  return {
    current: n > 0 ? kTexts[n - 1] : "",
    previous: n > 1 ? kTexts[n - 2] : "",
    older: n > 2 ? kTexts[n - 3] : "",
  };
}
