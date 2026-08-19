// K Conversation Engine — Conversation Action Selector (071 §5, §9-10 / 073 §5).
// Action은 출력 템플릿이 아니라 "방향"만 결정한다. 고정 문구는 여기서 절대 만들지 않는다 —
// 실제 문장은 responseGenerator가 Action+Persona+발화+Context+History+mode로 Gemini에게 생성시킨다.
// 매 턴 "공감+다음질문" 패턴을 강제하지 않기 위해, 최근 선택한 Action을 피해 다양성을 유지한다.
//
// codex-rv 지적 반영: 기존 reactionEngine의 성긴 10-카테고리 대신 utteranceSignals.ts의
// 세밀한 신호를 근거로 선택한다("100점 맞았어"→CELEBRATION, "방귀"→JOKE 등 실제로 구분됨).
// app_mode_question/unclear_audio는 index.ts에서 이 함수 호출 전에 결정론적으로 처리되므로
// 여기서는 다루지 않는다.
import type { ConversationAction } from "./types";
import type { BoredomAssessment } from "./boredomDetection";
import type { UtteranceSignals } from "./utteranceSignals";

export interface ActionSelectorInput {
  signals: UtteranceSignals;
  boredom: BoredomAssessment;
  hasRecentEpisode: boolean;
  hasLongTermMemory: boolean;
  /** 최근 K가 선택했던 Action들(오래된→최신). 반복 방지에만 사용. */
  recentActions: ConversationAction[];
  rand?: () => number;
}

// semantic_group cooldown은 이 함수에서 의도적으로 다루지 않는다 — 자유대화는 항상 아이
// 발화에 반응하는 구조라 "지금 이 주제가 cooldown 중"이라는 건 곧 아이가 스스로 다시
// 꺼냈다는 뜻이고, 그걸 K 재질문 제한에 쓰면 071 §9("아이가 먼저 꺼내는 건 제한 안 함")를
// 어긴다(codex-rv 3차 지적으로 발견, index.ts에서 관련 배선 제거). K가 스스로 새 화제를
// 능동적으로 고르는 지점이 생기면(예: 073 질문은행) 그 로직에서 cooldown을 확인한다.
const BOREDOM_ACTIONS: ConversationAction[] = ["PLAY_PROPOSAL", "TOPIC_SHIFT", "JUST_LISTEN", "JOKE", "IMAGINATION"];

function pickAvoidingRecent(
  candidates: ConversationAction[],
  recentActions: ConversationAction[],
  rand: () => number,
): ConversationAction {
  const lastTwo = new Set(recentActions.slice(-2));
  const fresh = candidates.filter((a) => !lastTwo.has(a));
  const pool = fresh.length > 0 ? fresh : candidates;
  return pool[Math.floor(rand() * pool.length)];
}

/** candidates[0]은 "이 신호에서 반드시 지켜야 하는 방향"이다(codex-rv 2차 지적: 이전 버전은
 * "100점 맞았어"도 CELEBRATION/CURIOSITY/PLAYFUL_TEASING 중 완전 무작위였다). 바로 직전
 * Action과만 겹치지 않으면 그대로 쓰고, 겹칠 때만 나머지 후보 중에서 다양성을 준다. */
function pickPrimaryOrRotate(
  candidates: ConversationAction[],
  recentActions: ConversationAction[],
  rand: () => number,
): ConversationAction {
  const primary = candidates[0];
  const lastAction = recentActions[recentActions.length - 1];
  if (primary !== lastAction) return primary;
  const rest = candidates.slice(1);
  if (rest.length === 0) return primary;
  return rest[Math.floor(rand() * rest.length)];
}

/** 신호 조합으로 후보 Action 목록을 만든다. 우선순위: 갈등 > 부정감정 > 신체상태 >
 * 초성게임 시작 > 성취/긍정감정 > 장난/상상 > 기억회상 질의 > 일반지식 질문 > 놀이 요청(미지정) > 중립.
 * hasDeterministicPrimary=true인 신호는 candidates[0]을 강하게 지켜야 하는 필수 방향으로
 * 다룬다(pickPrimaryOrRotate 사용) — 그 외는 다양성을 우선한다(pickAvoidingRecent 사용). */
function candidatesFromSignals(
  signals: UtteranceSignals,
  hasMemory: boolean,
): { candidates: ConversationAction[]; deterministic: boolean } {
  if (signals.hasConflict) return { candidates: ["EMPATHY", "COMFORT", "FOLLOW_UP"], deterministic: true };
  if (signals.hasNegativeEmotion) return { candidates: ["EMPATHY", "COMFORT", "FOLLOW_UP"], deterministic: true };
  if (signals.hasPhysicalNeed) return { candidates: ["EMPATHY", "COMFORT"], deterministic: true };
  if (signals.hasChosungGameStart) return { candidates: ["PLAYFUL_GAME_CHOSUNG"], deterministic: true };
  // 018 §3-11 — 아이가 케이에게 애착을 표현했으면 그걸 먼저 받아준다.
  //
  // 그냥 지나치고 다음 질문으로 넘어가면 아이는 무시당했다고 느낀다. 성취·긍정감정보다
  // 앞에 두는 이유는 "케이 좋아해" 가 일반 긍정 발화로 흘러가면 축하 반응이 나오는데,
  // 축하는 이 말에 대한 답이 아니기 때문이다.
  // 게임 시작 요청보다는 뒤다 — "케이 좋아해 초성게임하자" 는 게임을 시작해야 한다.
  //
  // 받아주는 방식의 한계(독점·의존 유도 금지)는 RELATIONSHIP_SAFETY_INSTRUCTION 과
  // 출력단 관계 안전 가드가 이미 막는다. 여기서는 방향만 정한다.
  if (signals.hasAffectionTowardK) {
    return { candidates: ["EMPATHY", "FOLLOW_UP"], deterministic: true };
  }
  if (signals.hasAchievement) return { candidates: ["CELEBRATION", "CURIOSITY", "PLAYFUL_TEASING"], deterministic: true };
  if (signals.hasPositiveEmotion) return { candidates: ["CELEBRATION", "CURIOSITY", "FOLLOW_UP"], deterministic: false };
  if (signals.hasPlayfulSilly) return { candidates: ["JOKE", "PLAYFUL_TEASING", "IMAGINATION"], deterministic: false };
  if (signals.hasImaginative) return { candidates: ["IMAGINATION", "JOKE", "CURIOSITY"], deterministic: false };
  if (signals.hasMemoryRecallQuery) {
    return hasMemory
      ? { candidates: ["MEMORY_RECALL"], deterministic: true }
      : { candidates: ["OWN_OPINION", "JUST_LISTEN"], deterministic: true };
  }
  if (signals.hasGeneralKnowledgeQuestion) return { candidates: ["OWN_OPINION", "CURIOSITY"], deterministic: true };
  if (signals.hasPlayRequestWithoutTarget) return { candidates: ["PLAY_PROPOSAL", "JOKE", "CURIOSITY"], deterministic: false };
  if (signals.isVeryShortLowEffort) return { candidates: ["JUST_LISTEN", "CURIOSITY"], deterministic: false };
  return { candidates: ["FOLLOW_UP", "CURIOSITY", "JUST_LISTEN"], deterministic: false };
}

/** Safety는 이 함수 이전에 별도로 처리된다 — 이 함수는 안전 게이트를 통과한 발화에만 호출한다. */
export function selectAction(input: ActionSelectorInput): ConversationAction {
  const rand = input.rand ?? Math.random;

  const { candidates, deterministic } = candidatesFromSignals(
    input.signals,
    input.hasRecentEpisode || input.hasLongTermMemory,
  );

  // codex-rv 3차 지적: 이전 버전은 boredom rising/high면 무조건 결정론 신호(성취 등)를
  // 건너뛰었다 — "100점 맞았어!" 같은 강한 현재 신호는 지난 몇 턴의 boredom 패턴보다
  // 우선해야 한다. deterministic 신호가 없을 때만(중립/장난/상상처럼 약한 신호일 때만)
  // boredom 대응으로 넘어간다.
  if (!deterministic && (input.boredom.level === "high" || input.boredom.level === "rising")) {
    return pickAvoidingRecent(BOREDOM_ACTIONS, input.recentActions, rand);
  }

  return deterministic
    ? pickPrimaryOrRotate(candidates, input.recentActions, rand)
    : pickAvoidingRecent(candidates, input.recentActions, rand);
}
