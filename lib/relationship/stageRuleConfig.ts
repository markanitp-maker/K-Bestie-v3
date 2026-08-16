import {
  DEFAULT_STAGE_RULE_SET,
  type RelationshipStageRuleSet,
  type RelationshipStageThreshold,
} from "./effectiveStage";

const REQUIRED_STAGES: ReadonlyArray<"W2" | "W3" | "W4"> = ["W2", "W3", "W4"];
const VALID_STAGE_SET = new Set<string>(REQUIRED_STAGES);

function isValidNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validateRuleSet(candidate: unknown): candidate is RelationshipStageRuleSet {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  if (typeof record.version !== "string" || record.version.trim() === "") {
    return false;
  }

  if (!Array.isArray(record.thresholds)) {
    return false;
  }

  const seenStages = new Set<string>();

  for (const item of record.thresholds) {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const t = item as Record<string, unknown>;
    if (typeof t.stage !== "string" || !VALID_STAGE_SET.has(t.stage)) {
      return false;
    }
    if (seenStages.has(t.stage)) {
      // 중복 stage 정의 방지
      return false;
    }
    seenStages.add(t.stage);

    if (
      !isValidNonNegativeInteger(t.minConversationCount) ||
      !isValidNonNegativeInteger(t.minConversationDays) ||
      !isValidNonNegativeInteger(t.minUsableMemoryCount) ||
      !isValidNonNegativeInteger(t.minSharedMemoryCount) ||
      !isValidNonNegativeInteger(t.minRelationshipEventCount)
    ) {
      return false;
    }
  }

  // 3단계를 전부 적어야만 통과하게 만들면 threshold 하나만 조정할 수 없어
  // §7의 "운영 중 조정 가능"이 성립하지 않는다. 지정한 단계만 덮어쓰고
  // 나머지는 기본값을 그대로 쓴다. 단 최소 1개는 있어야 의미가 있다.
  if (seenStages.size === 0) {
    return false;
  }

  return true;
}

/** 지정한 단계만 덮어쓰고 나머지는 기본값을 유지한다. */
function mergeWithDefaults(parsed: RelationshipStageRuleSet): RelationshipStageRuleSet {
  const overrideByStage = new Map(parsed.thresholds.map((t) => [t.stage, t]));
  return {
    version: parsed.version,
    thresholds: DEFAULT_STAGE_RULE_SET.thresholds.map(
      (base) => overrideByStage.get(base.stage) ?? base,
    ),
  };
}

/**
 * 기본값은 DEFAULT_STAGE_RULE_SET.
 * RELATIONSHIP_STAGE_RULES(JSON 문자열)가 있으면 파싱 및 검증 후 덮어쓴다.
 * 파싱 실패 또는 형식 불일치 시 기본값으로 fail-safe하며 console.error로 로깅한다.
 */
export function loadRelationshipStageRuleSet(env?: NodeJS.ProcessEnv): RelationshipStageRuleSet {
  const targetEnv: NodeJS.ProcessEnv | Record<string, string | undefined> =
    env ?? (typeof process !== "undefined" ? process.env : {});
  const rawRules = targetEnv.RELATIONSHIP_STAGE_RULES;

  if (!rawRules || typeof rawRules !== "string" || rawRules.trim() === "") {
    return DEFAULT_STAGE_RULE_SET;
  }

  try {
    const parsed: unknown = JSON.parse(rawRules);
    if (!validateRuleSet(parsed)) {
      console.error(
        "[stageRuleConfig] RELATIONSHIP_STAGE_RULES 유효성 검증 실패. 기본 규칙(DEFAULT_STAGE_RULE_SET)으로 복구합니다. 원문:",
        rawRules,
      );
      return DEFAULT_STAGE_RULE_SET;
    }

    return mergeWithDefaults(parsed);
  } catch (error) {
    console.error(
      "[stageRuleConfig] RELATIONSHIP_STAGE_RULES JSON 파싱 오류. 기본 규칙(DEFAULT_STAGE_RULE_SET)으로 복구합니다. 원문:",
      rawRules,
      error,
    );
    return DEFAULT_STAGE_RULE_SET;
  }
}
