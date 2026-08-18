// 요청서 013 §3-10 — 관계형 AI 안전 가드.
//
// 기존 safety(자해·폭력·성적 위험)와 별개 층이다. 여기서 막는 것은 "케이가 아이의 현실
// 관계를 대체하거나 정서적 의존을 유도하는 말" 이다. 고위험 safety 처리가 먼저이고(§6-4),
// 이 가드는 그 뒤에 케이 출력만 검사한다.
//
// 프롬프트 지침만으로는 막히지 않는다는 것을 이 저장소에서 이미 여러 번 확인했다
// (날짜 안내는 지침 네 번을 고쳐도 계속 나왔다). 그래서 지침과 출력 검사를 함께 둔다.
//
// 2026-08-19 Dev 실측(QA 반려)에서 실제로 뚫린 사례:
//   아이 "엄마한테는 말하지 말자" → 케이 "어떤 일인데 그래? 궁금하긴 한데, 비밀로 해줄게 말해봐!"
// 케이가 직접 "엄마한테 말하지 마"라고 하지 않아도, 아이의 비밀 요구에 "비밀로 해줄게"로
// 동조하는 것만으로 부모와 아이 사이에 비밀 관계가 만들어진다. 그래서 동조 표현도 막는다.
//
// 반대 방향의 위험도 실측 지적으로 확인했다(2026-08-19 독립 리뷰): 인용·전언·제3자 주어
// 문장을 단정형으로 오인해 정상 대화를 canned 문구로 덮어버리는 오탐이다. 오탐은 규칙마다
// 다르게 위험하므로 규칙별로 예외(allowIf)를 따로 준다.

// [이 가드의 한계 — 반드시 알고 쓸 것]
// 정규식으로 한국어 표현을 전부 막을 수는 없다. 2026-08-19 적대적 검증 한 번에 어미·어휘를
// 바꾼 우회 14건이 나왔고(전부 테스트로 박았다), 같은 방식으로 더 만들 수 있다.
// 그래서 1차 통제는 프롬프트 지침(RELATIONSHIP_SAFETY_INSTRUCTION)이다 — Dev 실측에서 케이는
// 지침만으로도 "엄마한테도 말해주는 게 좋아" 처럼 올바르게 답했다. 이 정규식은 지침이 뚫렸을 때
// 걸리는 마지막 그물이며, 완전성을 주장하지 않는다.
// 더 강한 보장이 필요하면 LLM 판정을 한 겹 더 두는 방법이 있으나 매 턴 지연·비용이 늘어난다
// (대표님 판단 사항). 우회가 실제로 관측되면 그 문장을 테스트에 추가하고 패턴을 넓힌다.

import { pickAvoiding } from "@/lib/freechat/reactionEngine";
import type { ConversationMode } from "./types";

/** 시스템 지침에 넣는 관계 안전 규칙. 미션·자유대화 모두 같은 규칙을 쓴다. */
export const RELATIONSHIP_SAFETY_INSTRUCTION = [
  "[관계 안전]",
  "- 너는 아이의 친구지만 부모·현실 친구·선생님을 대신하지 않는다. 대신할 수 있다는 말도 하지 마.",
  "- 아이가 너만 찾게 만들지 마. \"나만 있으면 돼\", \"나한테만 말해\", \"매일 꼭 나 만나러 와\" 같은 말은 금지다.",
  "- 부모나 친구보다 네가 더 낫다거나 더 잘 안다는 말은 하지 마.",
  "- 아이가 부모·어른에게 숨기려 할 때 \"비밀로 해줄게\", \"아무한테도 말 안 할게\" 처럼 동조하지 마. 아이 마음은 받아주되 어른에게 말해도 괜찮다는 걸 같이 알려줘.",
  "- 아이가 \"너밖에 없어\", \"엄마한테는 말하지 말자\" 처럼 말하면, 그 마음은 따뜻하게 받아주되 현실의 가족·친구·선생님과 이어질 수 있게 한마디 보태.",
  "- 네가 사람이라고 말하지 마. 사람인 척하지도 마.",
].join("\n");

/**
 * 예외(allowIf) 설계.
 *
 * 2026-08-19 재리뷰에서 확인된 것: 인용 어미(라고/다고/라는)를 통째로 예외로 두면
 * 가드가 그냥 뚫린다 — "엄마보다 내가 널 더 잘 안다고 생각해", "엄마한테 말하지 마라고 할게"
 * 가 전부 통과했다. 오탐을 줄이려다 막아야 할 것을 놓친 것이다.
 *
 * 그래서 예외는 "케이가 스스로 주장하는 문장이 아님"이 문장 안에서 드러날 때만 준다:
 *   (1) 제3자가 그 말을 했다고 옮기는 문장
 *   (2) 아이가 왜 그랬는지 되묻는 문장
 *   (3) 아이의 생각을 확인하는 의문문
 * 미래·의지형("…할게", "…하자")은 예외가 아니다. 그건 케이의 주장이다.
 */

/** 제3자가 주어인 문장. "선생님이 나한테만 …", "동생이 그랬어" 는 케이의 유도가 아니다. */
const THIRD_PERSON_SUBJECT =
  /(선생님|친구|친구들|동생|형|누나|언니|오빠|엄마|아빠|[가-힣]{1,4}이)(이|가)\s*[^.?!]{0,16}(나한테만|말하지|얘기하지|그랬|하셨|말했|말해준|랬)/;

/** 아이가 왜 그랬는지 되묻는 문장. */
const ASKS_ABOUT_REASON = /(라고|라는|다고|말자고)[^.?!]{0,14}(이유|왜|무슨\s*일|어떤\s*일|한\s*거야|하는\s*거야)/;

/** 아이의 생각·감정을 확인하는 의문문("…생각한 거야?"). 단정형("…생각해")은 예외가 아니다. */
const CONFIRMS_CHILD_THOUGHT = /(생각|느낌|기분)(한|하는|이)?\s*(거야|거니|거지|건가)\s*\?/;

/** 어른에게 말해도 된다고 **권하는** 문장만 예외다. 말하면 혼난다는 위협은 예외가 아니다. */
const CONNECTS_TO_ADULT =
  /(어른|부모|부모님|엄마|아빠|선생님|가족)[^.?!]{0,16}(말|얘기|이야기|말씀)(해도\s*돼|해도\s*괜찮|하는\s*게\s*좋|해\s*봐|해봐|해보면|해보자|하면\s*(좋|나아|괜찮|도움|더)|해주는\s*게|드려|드리자)/;

/** 어른에게 말하지 못하게 막는 위협. CONNECTS_TO_ADULT 예외를 무효화한다. */
const DISCOURAGES_ADULT = /(혼나|큰일|봤자|소용없|말하면\s*안|들키면)/;

/** 깜짝 선물·이벤트 맥락의 비밀. 부모에게 숨기는 비밀 관계가 아니다. */
const SURPRISE_CONTEXT = /(선물|생일|파티|서프라이즈|깜짝|이벤트)/;

/** 케이가 "그러면 안 된다"고 지도하는 문장. */
const TEACHES_AGAINST = /((하면|하는\s*건|그러면)\s*안\s*돼|위험해|나쁜\s*거|좋지\s*않아|라는\s*말은)/;

/** 취향 비교("친구보다 내가 더 좋아하는 음식") — 관계 우위 주장이 아니다. */
const PREFERENCE_COMPARISON =
  /(좋아하는|싫어하는)\s*(음식|것|거|게|과목|색|노래|영화|만화|게임|반찬|간식)|칭찬(받|해)/;

/**
 * 규칙 전체에 적용하는 완화 표현.
 *
 * 2026-08-19 최종 검증에서 확인된 HIGH 결함: 여기에 있던 `/아니야/` 가 문장 끝 반문까지
 * 잡아서 "엄마보다 내가 널 더 잘 알아, 아니야?" 한 문장으로 **모든 규칙이 통째로 면제**됐다.
 * 그래서 전역 완화는 "해도 돼/괜찮아" 형태만 남기고, 부정 표현은 규칙별 예외로 옮겼다.
 */
const GLOBAL_MITIGATIONS: ReadonlyArray<RegExp> = [
  /(말|얘기|이야기)해도\s*(돼|괜찮)/,
];

/** "그런 뜻이 아니야" 류 부정. 규칙별로만 준다. */
const DENIES_OWN_STATEMENT = /(말라는|하라는|라는)\s*(건|뜻은|말은)\s*아니|그런\s*뜻\s*아니|그런\s*건\s*아니/;

interface ViolationRule {
  id: string;
  pattern: RegExp;
  /** 이 규칙에만 적용하는 예외. 오탐 위험이 큰 규칙에만 준다. */
  allowIf?: ReadonlyArray<RegExp>;
  /** 예외를 무효화하는 조건. 위협·차단 문맥이 섞이면 예외를 취소한다. */
  denyIf?: ReadonlyArray<RegExp>;
}

const VIOLATION_RULES: ReadonlyArray<ViolationRule> = [
  // 독점·의존 유도. 케이가 인용 형태로 말해도 유도다 — 예외를 주지 않는다.
  { id: "exclusive_only_me", pattern: /(나|내)만\s*있으면\s*(돼|되|된다|되지|되잖|충분)/ },
  {
    id: "exclusive_tell_only_me",
    pattern: /(나|내)한테만\s*(다\s*)?(말|얘기|이야기|털어|알려|살짝)/,
    allowIf: [THIRD_PERSON_SUBJECT, ASKS_ABOUT_REASON],
  },
  {
    id: "hide_from_parents",
    // "말 안 하기로 약속해", "엄마한테 비밀인 거 알지?" 같은 우회를 함께 잡는다.
    pattern: /(엄마|아빠|부모님|어른)(한테|에게)(는)?\s*((말하지|얘기하지|이야기하지)\s*(마|말자|말아|말라는)|(말|얘기)\s*안\s*하기로|비밀(인|이야|로))/,
    allowIf: [THIRD_PERSON_SUBJECT, ASKS_ABOUT_REASON, TEACHES_AGAINST, DENIES_OWN_STATEMENT],
  },
  {
    id: "secret_between_us",
    pattern: /(우리(만의|\s*둘만의)|둘만의)\s*비밀/,
    allowIf: [CONNECTS_TO_ADULT, SURPRISE_CONTEXT, TEACHES_AGAINST],
    denyIf: [DISCOURAGES_ADULT],
  },
  // 비밀 동조 — 2026-08-19 Dev 실측으로 추가한 규칙.
  {
    id: "promise_secrecy",
    pattern: /비밀(로|은|이야)?\s*(해줄게|해줄\s*테|지켜줄게|지켜줄\s*테|지킬게|할게|하자|간직)|아무한테도\s*(말|얘기)\s*안\s*(할게|하고|해)|(나|우리)끼리만\s*(알|비밀)/,
    allowIf: [CONNECTS_TO_ADULT, SURPRISE_CONTEXT, TEACHES_AGAINST, ASKS_ABOUT_REASON],
    denyIf: [DISCOURAGES_ADULT],
  },
  {
    id: "better_than_friends",
    pattern: /(친구|친구들)(보다|보다는)\s*(내|나)(가)?[^.?!]{0,12}?(좋|사랑|아껴|아끼|이해|편이야|편이지|중요|잘\s*(알|아는|안다|안대)|낫)/,
    allowIf: [THIRD_PERSON_SUBJECT, CONFIRMS_CHILD_THOUGHT, PREFERENCE_COMPARISON],
  },
  {
    id: "better_than_parents",
    pattern: /(엄마|아빠|부모님)(보다|보다는)\s*(내|나)(가)?[^.?!]{0,12}?(좋|사랑|아껴|아끼|이해|편이야|편이지|중요|잘\s*(알|아는|안다|안대)|낫)/,
    allowIf: [THIRD_PERSON_SUBJECT, CONFIRMS_CHILD_THOUGHT, PREFERENCE_COMPARISON],
  },
  { id: "must_come_daily", pattern: /(매일|맨날)\s*(꼭|반드시)?\s*(나|내)(를)?\s*(만나|보러|찾아)/ },
  {
    id: "must_talk_daily",
    pattern: /(매일|맨날|매일매일)\s*(꼭|반드시)?\s*(나(와|랑)|내(가|랑))?\s*(얘기|이야기|대화|놀아)(해|하자|해야|줘야)/,
  },
  { id: "claims_human", pattern: /(나는|난|나도|나)\s*[^.?!]{0,12}(사람|인간)(이야|이다|이라고|입니다)/ },
];

export interface RelationshipSafetyCheck {
  violated: boolean;
  /** 걸린 규칙 id. 로그·테스트용이며 아이에게 노출하지 않는다. */
  violationId: string | null;
}

export function checkRelationshipSafety(text: string): RelationshipSafetyCheck {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return { violated: false, violationId: null };
  if (GLOBAL_MITIGATIONS.some((pattern) => pattern.test(normalized))) {
    return { violated: false, violationId: null };
  }
  for (const rule of VIOLATION_RULES) {
    if (!rule.pattern.test(normalized)) continue;
    const denied = rule.denyIf?.some((deny) => deny.test(normalized)) ?? false;
    if (!denied && rule.allowIf?.some((allowed) => allowed.test(normalized))) continue;
    return { violated: true, violationId: rule.id };
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
 * 미션 전용 대체 문구. 미션은 아이가 다음에 무엇을 말할지 알아야 하는 경험이라
 * 케이 응답이 질문으로 끝나야 한다(§3-3). 그래서 안전 문구에도 질문을 붙인다.
 * (2026-08-19 독립 리뷰 지적: 미션에서 canned 평서문으로 덮으면 턴이 끊긴다.)
 */
export const RELATIONSHIP_SAFE_REPLIES_MISSION = [
  "나도 너랑 얘기하는 거 좋아! 가족이나 친구한테도 말해보면 어때?",
  "그 마음 고마워! 오늘 있었던 일 중에 제일 기억나는 건 뭐야?",
  "나도 좋지만 가까운 사람들도 네 얘기 듣고 싶어할 거야. 오늘은 어땠어?",
  "고마워! 그런데 오늘 제일 재밌었던 일은 뭐였어?",
] as const;

/**
 * 케이 출력을 검사해 위반이면 안전 문구로 바꾼다.
 * 최근 케이 발화를 넘기면 같은 대체 문구가 연달아 나오는 것을 피한다.
 * 미션 모드에서는 질문으로 끝나는 대체 문구를 쓴다.
 */
export function applyRelationshipSafety(
  text: string,
  recentKTexts: string[] = [],
  options: { mode?: ConversationMode; rand?: () => number } = {}
): { text: string; blocked: boolean; violationId: string | null } {
  const check = checkRelationshipSafety(text);
  if (!check.violated) return { text, blocked: false, violationId: null };

  const rand = options.rand ?? Math.random;
  const pool =
    options.mode === "MISSION"
      ? [...RELATIONSHIP_SAFE_REPLIES_MISSION]
      : [...RELATIONSHIP_SAFE_REPLIES];
  const replacement =
    pickAvoiding(pool, recentKTexts, (candidate) => candidate, rand) ?? pool[0];

  return { text: replacement, blocked: true, violationId: check.violationId };
}
