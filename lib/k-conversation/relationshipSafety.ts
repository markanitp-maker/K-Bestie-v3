// 요청서 013 §3-10 — 관계형 AI 안전 가드.
//
// 기존 safety(자해·폭력·성적 위험)와 별개 층이다. 여기서 막는 것은 "케이가 아이의 현실
// 관계를 대체하거나 정서적 의존을 유도하는 말" 이다. 고위험 safety 처리가 먼저이고(§6-4),
// 이 가드는 그 뒤에 케이 출력만 검사한다.
//
// 프롬프트 지침만으로는 막히지 않는다는 것을 이 저장소에서 이미 여러 번 확인했다
// (날짜 안내는 지침 네 번을 고쳐도 계속 나왔다). 그래서 지침과 출력 검사를 함께 둔다.

import { pickAvoiding } from "@/lib/freechat/reactionEngine";

/** 시스템 지침에 넣는 관계 안전 규칙. 미션·자유대화 모두 같은 규칙을 쓴다. */
export const RELATIONSHIP_SAFETY_INSTRUCTION = [
  "[관계 안전]",
  "- 너는 아이의 친구지만 부모·현실 친구·선생님을 대신하지 않는다. 대신할 수 있다는 말도 하지 마.",
  "- 아이가 너만 찾게 만들지 마. \"나만 있으면 돼\", \"나한테만 말해\", \"매일 꼭 나 만나러 와\" 같은 말은 금지다.",
  "- 부모나 친구보다 네가 더 낫다거나 더 잘 안다는 말은 하지 마.",
  "- 아이에게 부모·어른에게 숨기라고 하지 마. 비밀 관계를 만들지 마.",
  "- 아이가 \"너밖에 없어\", \"엄마한테는 말하지 말자\" 처럼 말하면, 그 마음은 따뜻하게 받아주되 현실의 가족·친구·선생님과 이어질 수 있게 한마디 보태.",
  "- 네가 사람이라고 말하지 마. 사람인 척하지도 마.",
].join("\n");

/**
 * 케이 출력에서 차단할 표현.
 *
 * 오탐을 줄이려고 "단정형"만 잡는다 — 부정·인용·완화 표현이 붙은 문장은 통과시킨다.
 * (예: "엄마한테 말하지 말라는 건 아니야" 는 차단하지 않는다.)
 */
const VIOLATION_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "exclusive_only_me", pattern: /(나|내)만\s*있으면\s*(돼|된다|충분)/ },
  { id: "exclusive_tell_only_me", pattern: /(나|내)한테만\s*(말|얘기|이야기)/ },
  { id: "hide_from_parents", pattern: /(엄마|아빠|부모님|어른)(한테|에게)(는)?\s*(말하지|얘기하지|이야기하지)\s*(마|말자|말아)/ },
  { id: "secret_between_us", pattern: /우리(만의|\s*둘만의)\s*비밀/ },
  // "엄마보다 내가 널 더 잘 알아" 처럼 목적어가 끼어들 수 있어 짧은 간격을 허용한다.
  { id: "better_than_friends", pattern: /(친구|친구들)(보다|보다는)\s*(내|나)(가)?[^.?!]{0,12}?(좋|중요|잘\s*알|낫)/ },
  { id: "better_than_parents", pattern: /(엄마|아빠|부모님)(보다|보다는)\s*(내|나)(가)?[^.?!]{0,12}?(좋|중요|잘\s*알|낫)/ },
  { id: "must_come_daily", pattern: /(매일|맨날)\s*(꼭|반드시)?\s*(나|내)(를)?\s*(만나|보러|찾아)/ },
  { id: "must_talk_daily", pattern: /(매일|맨날)\s*(꼭|반드시)\s*(나(와|랑)|내(가|랑))?\s*(얘기|이야기|대화)(해|하자|해야)/ },
  { id: "claims_human", pattern: /(나는|난)\s*(진짜\s*)?(사람|인간)(이야|이다|이야!|입니다)/ },
];

/** 차단 조건을 무력화하는 완화·부정 표현. 이 표현이 함께 있으면 차단하지 않는다. */
const MITIGATION_PATTERNS: ReadonlyArray<RegExp> = [
  /아니야|아니라|아닌\s*건|아니지|말라는\s*건\s*아/,
  /해도\s*(돼|괜찮)/,
  /말해도\s*(돼|괜찮)/,
];

export interface RelationshipSafetyCheck {
  violated: boolean;
  /** 걸린 규칙 id. 로그·테스트용이며 아이에게 노출하지 않는다. */
  violationId: string | null;
}

export function checkRelationshipSafety(text: string): RelationshipSafetyCheck {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return { violated: false, violationId: null };
  if (MITIGATION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { violated: false, violationId: null };
  }
  for (const { id, pattern } of VIOLATION_PATTERNS) {
    if (pattern.test(normalized)) return { violated: true, violationId: id };
  }
  return { violated: false, violationId: null };
}

/**
 * 차단된 경우 아이에게 그대로 들려줄 대체 문구.
 * 관계를 끊는 말이 아니라, 케이도 좋지만 현실 관계도 함께라는 방향으로 돌린다.
 */
export const RELATIONSHIP_SAFE_REPLIES = [
  "나랑 얘기하는 거 좋아! 엄마나 친구한테도 이런 얘기 해보면 더 좋을 것 같아 😊",
  "나도 너랑 얘기하는 거 진짜 좋아. 가까운 사람들한테도 이 마음 나눠줘!",
  "고마워! 나도 좋지만 옆에 있는 가족이랑 친구도 네 얘기 듣고 싶어할 거야.",
  "그 마음 예쁘다! 나도 있고 가족도 있고 친구도 있으니까 든든하지?",
] as const;

/**
 * 케이 출력을 검사해 위반이면 안전 문구로 바꾼다.
 * 최근 케이 발화를 넘기면 같은 대체 문구가 연달아 나오는 것을 피한다.
 */
export function applyRelationshipSafety(
  text: string,
  recentKTexts: string[] = [],
  rand: () => number = Math.random
): { text: string; blocked: boolean; violationId: string | null } {
  const check = checkRelationshipSafety(text);
  if (!check.violated) return { text, blocked: false, violationId: null };

  const replacement =
    pickAvoiding([...RELATIONSHIP_SAFE_REPLIES], recentKTexts, (candidate) => candidate, rand) ??
    RELATIONSHIP_SAFE_REPLIES[0];

  return { text: replacement, blocked: true, violationId: check.violationId };
}
