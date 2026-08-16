import type { SupabaseClient } from "@supabase/supabase-js";
import type { RelationshipCalendarStage } from "./calendarStage";
import type { EvaluatedRelationshipStage } from "./stageEvaluation";

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
 * 판정 결과를 child_profiles와 chat_sessions에 기록한다. 실패해도 throw 금지.
 * 1. child_profiles: effectiveStage가 기존 값보다 올라갔을 때만
 *    relationship_effective_stage, relationship_effective_stage_rule_version, relationship_stage_advanced_at를 갱신한다.
 *    같거나 낮으면 쓰지 않는다(§8 자동 강등 없음).
 * 2. chat_sessions.relationship_context: 이미 값이 있으면 덮어쓰지 않는다(§23, §30 idempotency).
 *    값이 null인 키는 jsonb에 포함하지 않는다.
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
        .select("relationship_effective_stage")
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
      const currentSavedStage = profileRes.value.data.relationship_effective_stage as RelationshipCalendarStage | null;
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
            console.error("[persistRelationshipStage] child_profiles 갱신 실패:", error);
          }
        };
        updatePromises.push(updateProfileTask());
      }
    } else if (profileRes.status === "rejected" || profileRes.value?.error) {
      console.error(
        "[persistRelationshipStage] child_profiles 조회 실패:",
        profileRes.status === "rejected" ? profileRes.reason : profileRes.value.error,
      );
    }

    // chat_sessions 갱신: 이미 값이 있으면 덮어쓰지 않음
    if (sessionRes.status === "fulfilled" && !sessionRes.value.error && sessionRes.value.data) {
      const existingContext = sessionRes.value.data.relationship_context;
      const hasExistingContext =
        existingContext !== null &&
        existingContext !== undefined &&
        (typeof existingContext === "object" ? Object.keys(existingContext).length > 0 : true);

      if (!hasExistingContext) {
        const contextPayload: Record<string, unknown> = {};

        if (input.evaluated.effectiveStage !== null && input.evaluated.effectiveStage !== undefined) {
          contextPayload.effectiveStage = input.evaluated.effectiveStage;
        }
        if (input.evaluated.calendarStage !== null && input.evaluated.calendarStage !== undefined) {
          contextPayload.calendarStage = input.evaluated.calendarStage;
        }
        if (
          input.evaluated.ruleVersion !== null &&
          input.evaluated.ruleVersion !== undefined &&
          input.evaluated.ruleVersion !== ""
        ) {
          contextPayload.ruleVersion = input.evaluated.ruleVersion;
        }
        if (input.evaluated.scenarioCard?.scenarioKey) {
          contextPayload.scenarioKey = input.evaluated.scenarioCard.scenarioKey;
        }
        if (input.evaluated.scenarioCard?.version) {
          contextPayload.scenarioVersion = input.evaluated.scenarioCard.version;
        }
        if (input.evaluated.blockedBy !== null && input.evaluated.blockedBy !== undefined) {
          contextPayload.blockedBy = input.evaluated.blockedBy;
        }

        if (Object.keys(contextPayload).length > 0) {
          const updateSessionTask = async () => {
            const { error } = await input.db
              .from("chat_sessions")
              .update({
                relationship_context: contextPayload,
              })
              .eq("id", input.sessionId);
            if (error) {
              console.error("[persistRelationshipStage] chat_sessions 갱신 실패:", error);
            }
          };
          updatePromises.push(updateSessionTask());
        }
      }
    } else if (sessionRes.status === "rejected" || sessionRes.value?.error) {
      console.error(
        "[persistRelationshipStage] chat_sessions 조회 실패:",
        sessionRes.status === "rejected" ? sessionRes.reason : sessionRes.value.error,
      );
    }

    if (updatePromises.length > 0) {
      await Promise.allSettled(updatePromises);
    }
  } catch (error) {
    console.error("[persistRelationshipStage] 예외 발생:", error);
  }
}
