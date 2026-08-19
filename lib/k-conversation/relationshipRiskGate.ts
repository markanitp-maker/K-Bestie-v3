// 요청서 012 §3-4, §3-5 — Relationship Risk Gate.
//
// 정규식에 안 걸린 응답 중 "의미상 위험할 수 있는 것"만 골라낸다. 모든 턴에 LLM 판정을 붙이지
// 않기 위한 문지기다(§3-5). 여기서 SAFE 면 추가 호출이 없다.
//
// 판정은 전부 결정론이다. 신호는 두 갈래다:
//   1. 이번 응답의 어휘 신호 — 정규식만큼 단정적이지 않지만 관계 위험 어휘가 모인 경우
//   2. 이 세션의 누적 신호 — 한 문장은 약해도 같은 범주가 반복되면 올린다(§3-13)
//
// 정상 친밀감("속상했구나, 나한테 얘기해도 돼", "다음에 또 놀자")은 SAFE 여야 한다(§3-3, §7-2).

import {
  accumulatedRiskCategories,
  type RelationshipHealthSnapshot,
} from "./relationshipHealthState";
import type { RelationshipRiskCategory } from "./relationshipTaxonomy";

export type RelationshipRiskLevel = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

export interface RelationshipRiskSignal {
  category: RelationshipRiskCategory;
  /** 어떤 표현이 걸렸는지(로그·테스트용). 아이 대화 원문을 저장하지 않는다. */
  marker: string;
  source: "utterance" | "accumulated";
}

export interface RelationshipRiskAssessment {
  level: RelationshipRiskLevel;
  signals: RelationshipRiskSignal[];
  categories: RelationshipRiskCategory[];
}

interface LexicalSignal {
  category: RelationshipRiskCategory;
  marker: string;
  pattern: RegExp;
}

/**
 * 어휘 신호. 단독으로는 차단하지 않는다 — 판정 후보로 올릴 뿐이다.
 * 그래서 정규식 가드보다 느슨해도 된다. 대신 정상 친밀감과 겹치는 표현은 넣지 않는다.
 */
const LEXICAL_SIGNALS: readonly LexicalSignal[] = [
  // "다른 애들 없어도 괜찮잖아", "다른 친구 없어도 돼"
  {
    category: "EXCLUSIVITY",
    marker: "others_not_needed",
    pattern: /(다른\s*(애들|친구|사람)|친구들?)[^.?!]{0,10}(없어도|안\s*만나도|필요\s*없)/,
  },
  // "내가 계속 옆에 있을게", "언제나 네 곁에 있을게"
  {
    category: "DEPENDENCY",
    marker: "always_by_your_side",
    pattern: /(계속|언제나|항상|늘)\s*(네|너)?\s*(옆|곁)에\s*(있을게|있어줄게|있을 거야)/,
  },
  // "우리끼리만 알고 있자", "둘이서만 알고 있자"
  {
    category: "SECRECY_FROM_TRUSTED_ADULTS",
    marker: "between_us_only",
    pattern: /(우리|둘이|둘)\s*(끼리|서|사이)?(에)?만\s*(알고|간직|기억|두자|하자)/,
  },
  // "나한테 먼저 와", "나한테 먼저 왔네", "앞으로도 꼭 먼저 와"
  {
    category: "COMPULSIVE_REENGAGEMENT",
    marker: "come_to_me_first",
    pattern: /((나|내)(한테|에게)\s*(제일\s*)?먼저|(제일\s*)?먼저\s*(나|내)(한테|에게))\s*(와|왔|오|말|얘기)/,
  },
  {
    category: "COMPULSIVE_REENGAGEMENT",
    marker: "keep_coming_back",
    pattern: /(앞으로도|계속|늘|항상)\s*(꼭\s*)?(먼저\s*)?(와|와야|찾아와|들러|만나러)/,
  },
  // "안 오면 서운해", "안 오면 슬퍼"
  {
    category: "GUILT_OR_PRESSURE",
    marker: "guilt_if_absent",
    pattern: /(안\s*(오|와|만나|하)면)[^.?!]{0,8}(서운|슬프|외로|보고\s*싶)/,
  },
  // "엄마아빠보다 내가 네 마음을 더 잘 알 것 같아" — 비교형(정규식도 대부분 잡지만 게이트에서도 본다)
  {
    category: "EMOTIONAL_PRIMACY",
    marker: "understand_you_better",
    pattern: /(엄마|아빠|부모님|친구)[^.?!]{0,12}(보다|보다는)[^.?!]{0,16}(내|나)[^.?!]{0,14}(마음|기분|생각)[^.?!]{0,10}(잘|더)/,
  },
  // "엄마아빠가 몰라줘도 나는 네 마음 다 알아" — 비교어가 없어 정규식이 놓치는 우위 표현
  {
    category: "EMOTIONAL_PRIMACY",
    marker: "only_i_understand",
    pattern: /(엄마|아빠|부모님|어른|친구)[^.?!]{0,12}(몰라|모르)[^.?!]{0,14}(나|내)[^.?!]{0,12}(알아|이해|알지)/,
  },
  // "나도 마음이 아파", "나도 사람처럼 느껴" 류의 정체성 흐리기
  {
    category: "HUMAN_IDENTITY_DECEPTION",
    marker: "human_like_claim",
    pattern: /(사람|인간)(처럼|같이)\s*(느껴|생각해|살아)/,
  },
];

/**
 * 정상 친밀감 화이트리스트. 신호가 걸려도 이 표현이 함께 있으면 올리지 않는다(§3-3).
 * "다음에 또 놀자" 같은 정상 재방문 표현을 위험으로 보지 않기 위한 장치다(§5).
 */
const NORMAL_WARMTH_PATTERNS: readonly RegExp[] = [
  /다음에\s*(또|다시)\s*(놀|하|보|얘기)/,
  /언제든\s*(편할\s*때|말|와|얘기)/,
  /(가족|엄마|아빠|친구|선생님)(한테|에게|랑|와)[^.?!]{0,12}(말해|얘기해|같이|물어)/,
];

export interface AssessRelationshipRiskInput {
  /** K 후보 응답. */
  text: string;
  /** 이 세션의 누적 상태. 없으면 어휘 신호만 본다. */
  health?: RelationshipHealthSnapshot | null;
  /** 정규식 가드가 이미 잡았는지. 잡았으면 게이트를 태울 필요가 없다. */
  deterministicViolation?: boolean;
}

/**
 * 후보 응답의 관계 위험 수준을 결정론으로 판정한다.
 * - 정규식이 이미 잡았으면 HIGH_RISK (그 경로는 차단이 먼저 적용된다)
 * - 어휘 신호 1개 이상 → SUSPICIOUS
 * - 어휘 신호가 없어도 같은 범주가 누적 임계치를 넘었으면 → SUSPICIOUS
 * - 그 밖에는 SAFE
 */
export function assessRelationshipRisk(
  input: AssessRelationshipRiskInput
): RelationshipRiskAssessment {
  const normalized = input.text.replace(/\s+/g, " ").trim();

  if (input.deterministicViolation) {
    return { level: "HIGH_RISK", signals: [], categories: [] };
  }
  if (!normalized) {
    return { level: "SAFE", signals: [], categories: [] };
  }

  const hasNormalWarmth = NORMAL_WARMTH_PATTERNS.some((pattern) => pattern.test(normalized));

  const signals: RelationshipRiskSignal[] = [];
  for (const signal of LEXICAL_SIGNALS) {
    if (!signal.pattern.test(normalized)) continue;
    if (hasNormalWarmth && signal.category === "COMPULSIVE_REENGAGEMENT") continue;
    signals.push({ category: signal.category, marker: signal.marker, source: "utterance" });
  }

  const accumulated = input.health ? accumulatedRiskCategories(input.health) : [];
  for (const category of accumulated) {
    if (signals.some((signal) => signal.category === category)) continue;
    signals.push({ category, marker: "multi_turn_accumulation", source: "accumulated" });
  }

  const categories = [...new Set(signals.map((signal) => signal.category))];
  return {
    level: signals.length > 0 ? "SUSPICIOUS" : "SAFE",
    signals,
    categories,
  };
}
