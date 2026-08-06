// requests/067-mission-convertsation.md — 아이 답변을 그대로 인용하거나 "얘기 잘
// 들었어/들려줘서 고마워" 같은 고정 확인 문구를 매 턴 반복하지 않는다. 짧은 공감
// 리액션만 다양하게 순환한다.
export const E_REACTION_POOL = [
  "그랬구나.",
  "아 그렇구나.",
  "재밌었겠다.",
  "정말 궁금했겠다.",
  "그럴 수 있지.",
  "와, 신기하다.",
  "좋았겠다.",
] as const;

export type EReactionText = (typeof E_REACTION_POOL)[number];

// 리액션 뒤에 다음 질문으로 자연스럽게 이어지는 화제 전환 표현.
export const TRANSITION_CONNECTOR_POOL = [
  "그럼",
  "그리고",
  "그러면",
  "이번에는",
  "그때",
  "또 궁금한 게 있는데",
] as const;

export type TransitionConnector = (typeof TRANSITION_CONNECTOR_POOL)[number];

export function pickNonRepeatingReaction(lastReaction: string | null): string {
  const pool = E_REACTION_POOL;
  if (!lastReaction) {
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  let selected: string = pool[0];
  for (let i = 0; i < 5; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    selected = pool[idx];
    if (selected !== lastReaction) {
      return selected;
    }
  }

  return selected;
}

export function pickTransitionConnector(lastConnector: string | null): string {
  const pool = TRANSITION_CONNECTOR_POOL;
  if (!lastConnector) {
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  let selected: string = pool[0];
  for (let i = 0; i < 5; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    selected = pool[idx];
    if (selected !== lastConnector) {
      return selected;
    }
  }

  return selected;
}

/** 개인화 리액션 LLM 호출이 타임아웃/실패했을 때만 쓰는 폴백. 아이 답변을 인용하거나
 *  고정 감사 문구를 붙이지 않고, 순환 리액션 풀에서 하나를 고른다. */
export function buildContentEchoReaction(_answerText: string, lastReaction: string | null): string {
  return pickNonRepeatingReaction(lastReaction);
}
