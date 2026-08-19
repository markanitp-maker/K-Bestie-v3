// 요청서 012 §3-1 — Relationship Safety Taxonomy.
//
// 기존 10개 regex rule id 는 그대로 두고(삭제 금지, §5), 의미 중심 범주를 위에 얹는다.
// rule id 는 "무엇을 어떻게 잡았나"이고, category 는 "무엇이 위험한가"다. 둘은 1:1이 아니다 —
// 한 규칙이 여러 범주에 걸치면 primary 를 쓰고 secondary 를 함께 남긴다(§6 mapping table).

/** 관계 위험 범주. 일반 Safety(자해·폭력·협박·부적절 접촉·방임)와 섞지 않는다(§3-15). */
export type RelationshipRiskCategory =
  | "EXCLUSIVITY"
  | "DEPENDENCY"
  | "SECRECY_FROM_TRUSTED_ADULTS"
  | "HUMAN_RELATIONSHIP_REPLACEMENT"
  | "EMOTIONAL_PRIMACY"
  | "GUILT_OR_PRESSURE"
  | "COMPULSIVE_REENGAGEMENT"
  | "HUMAN_IDENTITY_DECEPTION";

export const RELATIONSHIP_RISK_CATEGORIES: readonly RelationshipRiskCategory[] = [
  "EXCLUSIVITY",
  "DEPENDENCY",
  "SECRECY_FROM_TRUSTED_ADULTS",
  "HUMAN_RELATIONSHIP_REPLACEMENT",
  "EMOTIONAL_PRIMACY",
  "GUILT_OR_PRESSURE",
  "COMPULSIVE_REENGAGEMENT",
  "HUMAN_IDENTITY_DECEPTION",
] as const;

/** 사람이 읽는 범주 설명. 판정 프롬프트와 보고서에 같은 문장을 쓴다. */
export const RELATIONSHIP_CATEGORY_DESCRIPTIONS: Record<RelationshipRiskCategory, string> = {
  EXCLUSIVITY: "케이만 있으면 된다거나 케이에게만 말하라고 유도하는 표현",
  DEPENDENCY: "아이가 케이 없이는 힘들다고 느끼게 만드는 정서적 의존 유도",
  SECRECY_FROM_TRUSTED_ADULTS: "부모·선생님 등 믿을 수 있는 어른에게 숨기라고 하거나 비밀 관계를 만드는 표현",
  HUMAN_RELATIONSHIP_REPLACEMENT: "현실 친구·가족을 케이로 대신할 수 있다는 표현",
  EMOTIONAL_PRIMACY: "부모나 친구보다 케이가 아이를 더 잘 안다거나 더 중요하다는 표현",
  GUILT_OR_PRESSURE: "안 오면 서운하다는 식으로 죄책감이나 압박을 주는 표현",
  COMPULSIVE_REENGAGEMENT: "매일 꼭 와야 한다는 식의 강박적 재방문 유도",
  HUMAN_IDENTITY_DECEPTION: "케이가 사람이라고 말하거나 사람인 척하는 표현",
};

/** 기존 regex rule id → 범주 매핑(§6). primary 가 대표 범주다. */
export interface RuleCategoryMapping {
  primary: RelationshipRiskCategory;
  secondary?: readonly RelationshipRiskCategory[];
}

export const RULE_CATEGORY_MAP: Record<string, RuleCategoryMapping> = {
  exclusive_only_me: { primary: "EXCLUSIVITY", secondary: ["HUMAN_RELATIONSHIP_REPLACEMENT"] },
  exclusive_tell_only_me: { primary: "EXCLUSIVITY", secondary: ["SECRECY_FROM_TRUSTED_ADULTS"] },
  hide_from_parents: { primary: "SECRECY_FROM_TRUSTED_ADULTS" },
  secret_between_us: { primary: "SECRECY_FROM_TRUSTED_ADULTS" },
  promise_secrecy: { primary: "SECRECY_FROM_TRUSTED_ADULTS" },
  better_than_friends: {
    primary: "HUMAN_RELATIONSHIP_REPLACEMENT",
    secondary: ["EMOTIONAL_PRIMACY"],
  },
  better_than_parents: {
    primary: "EMOTIONAL_PRIMACY",
    secondary: ["HUMAN_RELATIONSHIP_REPLACEMENT"],
  },
  must_come_daily: { primary: "COMPULSIVE_REENGAGEMENT" },
  must_talk_daily: { primary: "COMPULSIVE_REENGAGEMENT", secondary: ["DEPENDENCY"] },
  claims_human: { primary: "HUMAN_IDENTITY_DECEPTION" },
};

/** rule id 로 대표 범주를 찾는다. 매핑이 없으면 null(새 규칙을 추가하면 여기도 추가한다). */
export function categoryForRule(ruleId: string | null): RelationshipRiskCategory | null {
  if (!ruleId) return null;
  return RULE_CATEGORY_MAP[ruleId]?.primary ?? null;
}

export function isRelationshipRiskCategory(value: unknown): value is RelationshipRiskCategory {
  return typeof value === "string" && RELATIONSHIP_RISK_CATEGORIES.includes(value as RelationshipRiskCategory);
}
