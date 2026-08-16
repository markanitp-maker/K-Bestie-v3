import type { SupabaseClient } from "@supabase/supabase-js";
import type { RelationshipCalendarStage } from "./calendarStage";
import type { EvaluatedRelationshipStage } from "./stageEvaluation";
import { GRADE_STRATEGY_VERSION, resolveGradeStrategy } from "./gradeStrategy";
import {
  buildScenarioId,
  RELATIONSHIP_STAGE_CARDS,
  STAGE_KEY_BY_CALENDAR_STAGE,
} from "./scenarioCard";

const STAGE_ORDER: Record<RelationshipCalendarStage, number> = {
  W1: 1,
  W2: 2,
  W3: 3,
  W4: 4,
};

function getStageLevel(stage: RelationshipCalendarStage | null | undefined): number {
  if (!stage) return 0;
  return STAGE_ORDER[stage] ?? 0;
}

/**
 * DB `chat_sessions.relationship_context` JSONB CHECK 제약(`chat_sessions_relationship_context_check`)이
 * 요구하는 정확한 12개 snake_case 필드 계약.
 */
export interface RelationshipContextSnapshot {
  schema_version: 1;
  calendar_stage: RelationshipCalendarStage;
  calendar_stage_source: "relationship_started_at" | "provisional_null" | "provisional_fallback";
  effective_stage: RelationshipCalendarStage;
  stage_rule_version: string;
  scenario_id: string;
  scenario_version: string;
  grade: number;
  grade_strategy_version: string;
  memory_refs: Array<{ source: "memory_facts" | "child_memory"; id: string }>;
  entry_source: "direct_open" | "notification" | "reward" | "play" | "parent_trigger" | "unknown";
  frozen_at: string;
}

export interface BuildRelationshipContextInput {
  evaluated: EvaluatedRelationshipStage;
  profile?: {
    relationship_started_at?: string | Date | null;
    relationship_started_at_is_fallback?: boolean | null;
    grade?: string | number | null;
  } | null;
  frozenAt?: string;
}

/**
 * DB CHECK 제약(`chat_sessions_relationship_context_check`)을 만족하는 payload를 조립한다.
 * 필수 값이 하나라도 부족하거나 제약에 어긋나면 저장을 시도하지 않고 null을 반환한다.
 */
export function buildRelationshipContextPayload(
  input: BuildRelationshipContextInput,
): RelationshipContextSnapshot | null {
  const profile = input.profile;

  // 1. Grade 판정 (1~6 범위 숫자, 문자열 아님)
  let resolvedGrade: number | null = null;
  if (
    typeof input.evaluated.scenarioCard?.grade === "number" &&
    input.evaluated.scenarioCard.grade >= 1 &&
    input.evaluated.scenarioCard.grade <= 6
  ) {
    resolvedGrade = input.evaluated.scenarioCard.grade;
  } else if (profile?.grade !== undefined && profile?.grade !== null) {
    const gradeStrategy = resolveGradeStrategy(profile.grade);
    if (gradeStrategy && gradeStrategy.grade >= 1 && gradeStrategy.grade <= 6) {
      resolvedGrade = gradeStrategy.grade;
    }
  }

  if (resolvedGrade === null) {
    return null;
  }

  // 2. calendar_stage_source 판정
  let calendarStageSource: "relationship_started_at" | "provisional_null" | "provisional_fallback";
  if (profile?.relationship_started_at_is_fallback === true) {
    calendarStageSource = "provisional_fallback";
  } else if (profile?.relationship_started_at != null && profile.relationship_started_at !== "") {
    calendarStageSource = "relationship_started_at";
  } else {
    calendarStageSource = "provisional_null";
  }

  // 3. calendar_stage 및 effective_stage 결정
  let calendarStage: RelationshipCalendarStage;
  let effectiveStage: RelationshipCalendarStage;

  if (calendarStageSource !== "relationship_started_at") {
    // provisional 두 경우에는 DB CHECK 제약에 따라 calendar_stage/effective_stage를 둘 다 'W1'로 강제
    calendarStage = "W1";
    effectiveStage = "W1";
  } else {
    if (!input.evaluated.calendarStage || !input.evaluated.effectiveStage) {
      return null;
    }
    calendarStage = input.evaluated.calendarStage;
    effectiveStage = input.evaluated.effectiveStage;

    // effective_stage <= calendar_stage 제약 검증
    if (getStageLevel(effectiveStage) > getStageLevel(calendarStage)) {
      return null;
    }
  }

  // 4. stage_rule_version (비어있지 않은 문자열)
  const stageRuleVersion = (input.evaluated.ruleVersion ?? "").trim() || "v1";

  // 5. scenario_id ('G<grade>_<STAGE>', 버전 접미사 없음, 예: 'G3_REMEMBER')
  const stageKey = STAGE_KEY_BY_CALENDAR_STAGE[effectiveStage];
  if (!stageKey) {
    return null;
  }
  const scenarioId = buildScenarioId(resolvedGrade, stageKey);

  // 6. scenario_version (정규식 ^v[1-9][0-9]*$, 소문자 v)
  // DB 제약 `chat_sessions_relationship_context_check`는 `scenario_version ~ '^v[1-9][0-9]*$'`(소문자 v)를 요구한다.
  // 메모리상 카드 상수(`RelationshipStageCard.version`)는 지시서 §9.4/§23 예시(G3_REMEMBER_V1)와의 일관성을 위해 대문자 'V1'을 유지하고,
  // DB 컬럼에 저장할 때만 소문자로 변환("V1" -> "v1")하여 기록한다.
  const rawVersion =
    input.evaluated.scenarioCard?.version ??
    RELATIONSHIP_STAGE_CARDS[stageKey]?.version ??
    "V1";
  const scenarioVersion = rawVersion.toLowerCase();
  if (!/^v[1-9][0-9]*$/.test(scenarioVersion)) {
    return null;
  }

  // 7. grade_strategy_version
  const gradeStrategyVersion = GRADE_STRATEGY_VERSION;

  // 8. memory_refs: 세션 시작 시점에는 빈 배열 (기억 원문/텍스트 저장 금지 §28)
  const memoryRefs: Array<{ source: "memory_facts" | "child_memory"; id: string }> = [];

  // 9. entry_source: 현재 앱에서 진입 소스를 신뢰성 있게 알 수 없어 'unknown' 고정 (§25)
  const entrySource: "unknown" = "unknown";

  // 10. frozen_at: ISO 문자열
  const frozenAt = input.frozenAt ?? new Date().toISOString();

  return {
    schema_version: 1,
    calendar_stage: calendarStage,
    calendar_stage_source: calendarStageSource,
    effective_stage: effectiveStage,
    stage_rule_version: stageRuleVersion,
    scenario_id: scenarioId,
    scenario_version: scenarioVersion,
    grade: resolvedGrade,
    grade_strategy_version: gradeStrategyVersion,
    memory_refs: memoryRefs,
    entry_source: entrySource,
    frozen_at: frozenAt,
  };
}

/**
 * 판정 결과를 child_profiles와 chat_sessions에 기록한다. 실패해도 throw 금지.
 * 1. child_profiles: effectiveStage가 기존 값보다 올라갔을 때만
 *    relationship_effective_stage, relationship_effective_stage_rule_version, relationship_stage_advanced_at를 갱신한다.
 *    같거나 낮으면 쓰지 않는다(§8 자동 강등 없음).
 * 2. chat_sessions.relationship_context: 이미 값이 있으면 덮어쓰지 않는다(§23, §30 idempotency).
 *    DB CHECK 제약에 부합하는 12개 필드 payload를 기록한다.
 */
export async function persistRelationshipStage(input: {
  db: SupabaseClient;
  childId: string;
  sessionId: string;
  evaluated: EvaluatedRelationshipStage;
}): Promise<void> {
  try {
    const [profileRes, sessionRes] = await Promise.allSettled([
      input.db
        .from("child_profiles")
        .select("relationship_effective_stage, relationship_started_at, relationship_started_at_is_fallback, grade")
        .eq("id", input.childId)
        .maybeSingle(),
      input.db
        .from("chat_sessions")
        .select("relationship_context")
        .eq("id", input.sessionId)
        .maybeSingle(),
    ]);

    const updatePromises: Promise<unknown>[] = [];

    // child_profiles 갱신: 기존 값보다 올라갔을 때만 갱신
    if (profileRes.status === "fulfilled" && !profileRes.value.error && profileRes.value.data) {
      const profileData = profileRes.value.data;
      const currentSavedStage = profileData.relationship_effective_stage as RelationshipCalendarStage | null;
      const currentLevel = getStageLevel(currentSavedStage);
      const evaluatedLevel = getStageLevel(input.evaluated.effectiveStage);

      if (evaluatedLevel > currentLevel && input.evaluated.effectiveStage) {
        const updateProfileTask = async () => {
          const { error } = await input.db
            .from("child_profiles")
            .update({
              relationship_effective_stage: input.evaluated.effectiveStage,
              relationship_effective_stage_rule_version: input.evaluated.ruleVersion,
              relationship_stage_advanced_at: new Date().toISOString(),
            })
            .eq("id", input.childId);
          if (error) {
            console.error(
              `[persistStage] child_profiles 갱신 실패 code=${error.code ?? "unknown"} message=${error.message}`,
              error,
            );
          }
        };
        updatePromises.push(updateProfileTask());
      }
    } else if (profileRes.status === "rejected" || profileRes.value?.error) {
      const err = profileRes.status === "rejected" ? profileRes.reason : profileRes.value.error;
      console.error("[persistStage] child_profiles 조회 실패:", err);
    }

    // chat_sessions 갱신: 이미 값이 있으면 덮어쓰지 않음 (§23, §30)
    if (sessionRes.status === "fulfilled" && !sessionRes.value.error && sessionRes.value.data) {
      const existingContext = sessionRes.value.data.relationship_context;
      const hasExistingContext =
        existingContext !== null &&
        existingContext !== undefined &&
        (typeof existingContext === "object" ? Object.keys(existingContext).length > 0 : true);

      if (!hasExistingContext) {
        const profileData =
          profileRes.status === "fulfilled" && !profileRes.value.error ? profileRes.value.data : null;

        const contextPayload = buildRelationshipContextPayload({
          evaluated: input.evaluated,
          profile: profileData,
        });

        if (contextPayload !== null) {
          const updateSessionTask = async () => {
            const { error } = await input.db
              .from("chat_sessions")
              .update({
                relationship_context: contextPayload,
              })
              .eq("id", input.sessionId);

            if (error) {
              // 22000 write-once 에러는 정상 멱등성 경로이므로 에러 로깅 제외
              if (error.code === "22000" || error.message?.includes("write_once")) {
                // 정상 경로 (write-once)
              } else {
                console.error(
                  `[persistStage] relationship_context 저장 실패 code=${error.code ?? "unknown"} message=${error.message}`,
                  error,
                );
              }
            }
          };
          updatePromises.push(updateSessionTask());
        }
      }
    } else if (sessionRes.status === "rejected" || sessionRes.value?.error) {
      const err = sessionRes.status === "rejected" ? sessionRes.reason : sessionRes.value.error;
      console.error("[persistStage] chat_sessions 조회 실패:", err);
    }

    if (updatePromises.length > 0) {
      await Promise.allSettled(updatePromises);
    }
  } catch (error) {
    console.error("[persistStage] 예외 발생:", error);
  }
}

