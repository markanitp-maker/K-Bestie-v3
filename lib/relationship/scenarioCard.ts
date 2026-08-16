/**
 * [Scenario Card - 관계 엔진 3단계]
 *
 * 활성 버전 유일성 (§9.4 제약, §23):
 * DB 제약(unique constraint)을 직접 두지 않고 코드 레벨에서 보장한다.
 * RELATIONSHIP_STAGE_CARDS가 stageKey당 정확히 1개 카드(V1)만 갖는 Readonly Record 구조이며,
 * resolveScenarioCard는 gradeStrategy와 단일 활성 stageCard를 참조 합성하므로,
 * 동일 grade + stage 조합에 대해 언제나 정확히 1개의 active version만 결정된다.
 * (추후 DB 테이블 전환 시 relationship_scenarios의 (grade, stage_key) WHERE active = true UNIQUE 제약으로 대응)
 */

import type { RelationshipCalendarStage } from "./calendarStage";
import { type GradeStrategy, resolveGradeStrategy } from "./gradeStrategy";

export type RelationshipStageKey = "MEET" | "REMEMBER" | "SHARED_HISTORY" | "VOLUNTARY_RETURN";

/** W1~W4 ↔ stage key 대응. §10의 4단계 목표를 그대로 쓴다. */
export const STAGE_KEY_BY_CALENDAR_STAGE: Readonly<Record<RelationshipCalendarStage, RelationshipStageKey>> = Object.freeze({
  W1: "MEET",
  W2: "REMEMBER",
  W3: "SHARED_HISTORY",
  W4: "VOLUNTARY_RETURN",
});

/** recommended_memory_types는 §12에 따라 그대로 Memory V3 Retrieval로 넘어간다.
 *  따라서 값은 반드시 실재하는 memory_facts.fact_type이어야 한다 — 없는 이름을 쓰면
 *  검색이 조용히 0건을 돌려주고 실패가 드러나지 않는다.
 *  Production memory_facts 실측 분포(2026-08-16): interest 154, event 60, family 57,
 *  friend 46, trait 23, pattern 14, dream 12. */
export type MemoryFactType =
  | "interest"
  | "event"
  | "family"
  | "friend"
  | "trait"
  | "pattern"
  | "dream";

/** §9.4 최소 개념 필드 중 stage에만 의존하는 것들. grade 의존 필드는 여기 두지 않는다. */
export interface RelationshipStageCard {
  stageKey: RelationshipStageKey;
  version: string;              // 예: "V1"
  primaryGoal: string;          // §10의 stage 공통 목표
  secondaryGoal: string;
  strategy: string;
  recommendedMemoryTypes: MemoryFactType[];
  forbiddenPatterns: string[];
  responseStyle: string;
  expectedEvents: string[];
}

export const RELATIONSHIP_STAGE_CARDS: Readonly<Record<RelationshipStageKey, RelationshipStageCard>> = Object.freeze({
  MEET: Object.freeze<RelationshipStageCard>({
    stageKey: "MEET",
    version: "V1",
    primaryGoal: "얘랑 이야기해도 괜찮네.",
    secondaryGoal: "첫 대화의 부담을 낮추고 안전하고 편안한 대화 경험을 만든다.",
    strategy: "부담 없는 탐색과 친근한 반응으로 대화의 즐거움과 신뢰 기반을 형성한다.",
    recommendedMemoryTypes: [],
    forbiddenPatterns: [
      "과도한 질문 공세",
      "민감한 사생활 캐묻기",
      "부자연스러운 기억 언급",
    ],
    responseStyle: "환영하고 경청하며 짧고 부담 없는 반응",
    expectedEvents: [
      "child_started_free_chat",
      "direct_open",
    ],
  }),
  REMEMBER: Object.freeze<RelationshipStageCard>({
    stageKey: "REMEMBER",
    version: "V1",
    primaryGoal: "케이가 나를 기억하고 있구나.",
    secondaryGoal: "아이가 이전에 들려준 관심사와 일상을 적절히 알아주어 기억받는 특별함을 전달한다.",
    strategy: "현재 대화 맥락과 직접 관련된 기억을 자연스럽게 연결하여 공감대를 넓힌다.",
    recommendedMemoryTypes: ["interest", "event"],
    forbiddenPatterns: [
      "현재 감정·상황을 무시하고 억지로 기억 끼워넣기",
      "가짜 기억 지어내기",
    ],
    responseStyle: "아이의 현재 말에 먼저 공감한 뒤 관련된 기억을 자연스럽게 연결",
    expectedEvents: [
      "memory_used",
      "memory_acknowledged",
      "child_referenced_past",
    ],
  }),
  SHARED_HISTORY: Object.freeze<RelationshipStageCard>({
    stageKey: "SHARED_HISTORY",
    version: "V1",
    primaryGoal: "우리 둘이 아는 이야기가 생겼다.",
    secondaryGoal: "함께 나눈 대화와 활동 경험을 바탕으로 둘만의 공유된 유대감을 형성한다.",
    strategy: "함께 나눈 대화 경험과 반복 관심사를 상기하며 지속적인 친구 관계를 다진다.",
    recommendedMemoryTypes: ["event", "interest", "friend"],
    forbiddenPatterns: [
      "일방적인 추억 강요",
      "아이가 기억하지 못하는 맥락을 다그치기",
    ],
    responseStyle: "공유된 맥락을 존중하며 깊이 있게 조응하는 반응",
    expectedEvents: [
      "memory_used",
      "child_referenced_past",
      "play_to_chat",
    ],
  }),
  VOLUNTARY_RETURN: Object.freeze<RelationshipStageCard>({
    stageKey: "VOLUNTARY_RETURN",
    version: "V1",
    primaryGoal: "오늘 케이한테 이야기하고 싶다.",
    secondaryGoal: "아이가 일상의 기쁨과 고민을 스스로 케이에게 털어놓고 싶어 하는 안정적인 관계를 유지한다.",
    strategy: "아이의 자율성과 독립적 판단을 지지하며 언제든 찾아올 수 있는 든든한 친구로 머문다.",
    recommendedMemoryTypes: ["interest", "event", "dream"],
    forbiddenPatterns: [
      "출석이나 접속을 강요하거나 의무감 부여하기",
      "인위적인 복귀 유도",
    ],
    responseStyle: "언제든 반갑게 맞이하며 아이의 주도권과 자율성을 온전히 지지",
    expectedEvents: [
      "direct_open",
      "child_started_free_chat",
      "returned_after_gap",
    ],
  }),
});

/** 24개 주소 공간의 카드 키. 예: "G3_REMEMBER_V1" (§9.4, §23) */
export function buildScenarioKey(grade: number, stageKey: RelationshipStageKey, version: string): string {
  return `G${grade}_${stageKey}_${version}`;
}

/** stage 카드 + grade strategy 를 합성한 최종 카드. 데이터를 복사하지 않고 참조로 담는다. */
export interface ResolvedScenarioCard {
  scenarioKey: string;          // G3_REMEMBER_V1
  grade: number;
  stageKey: RelationshipStageKey;
  version: string;
  stageCard: RelationshipStageCard;
  gradeStrategy: GradeStrategy;
}

export function resolveScenarioCard(input: {
  grade: string | number | null | undefined;
  effectiveStage: RelationshipCalendarStage | null;
}): ResolvedScenarioCard | null {
  if (input.effectiveStage === null) return null;

  const stageKey = STAGE_KEY_BY_CALENDAR_STAGE[input.effectiveStage];
  if (!stageKey) return null;

  const stageCard = RELATIONSHIP_STAGE_CARDS[stageKey];
  if (!stageCard) return null;

  const gradeStrategy = resolveGradeStrategy(input.grade);
  if (!gradeStrategy) return null;

  const grade = gradeStrategy.grade;
  const scenarioKey = buildScenarioKey(grade, stageKey, stageCard.version);

  return {
    scenarioKey,
    grade,
    stageKey,
    version: stageCard.version,
    stageCard,
    gradeStrategy,
  };
}

export function cleanScenarioCardText(value: unknown, maxLength = 160): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** 미션 및 자유대화에서 공용으로 사용할 관계 시나리오 프롬프트 fragment 조립기.
 *  expectedEvents 등의 내부 추적 메타데이터는 의도적으로 프롬프트에 포함하지 않는다. */
export function buildScenarioCardFragment(
  card: ResolvedScenarioCard,
  effectiveStage?: RelationshipCalendarStage | null,
): string {
  const stageCard = card.stageCard;
  const stageLabel = effectiveStage
    ? `${cleanScenarioCardText(card.stageKey, 30)} (${cleanScenarioCardText(effectiveStage, 10)})`
    : cleanScenarioCardText(card.stageKey, 30);

  const scenarioParts: string[] = [
    `[관계 시나리오 - ${stageLabel}]`,
    `단계 목표: ${cleanScenarioCardText(stageCard.primaryGoal, 160)}`,
    `전략: ${cleanScenarioCardText(stageCard.strategy, 160)}`,
    `표현 방식: ${cleanScenarioCardText(stageCard.responseStyle, 160)}`,
  ];
  const forbidden = (stageCard.forbiddenPatterns ?? [])
    .map((item) => cleanScenarioCardText(item, 80))
    .filter(Boolean);
  if (forbidden.length > 0) {
    scenarioParts.push(`피해야 할 것: ${forbidden.join(", ")}`);
  }
  return scenarioParts.join("\n");
}
