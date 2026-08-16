import type { SupabaseClient } from "@supabase/supabase-js";

import type { RelationshipStageKey } from "./effectiveStage";

export interface ResolvedScenario {
  id: string;
  scenarioKey: string;
  grade: string;
  stageKey: RelationshipStageKey;
  version: number;
  primaryGoal: string;
  secondaryGoal: string | null;
  strategy: unknown;
  recommendedMemoryTypes: string[];
  forbiddenPatterns: string[];
  responseStyle: unknown;
  expectedEvents: string[];
}

type RelationshipScenarioRow = {
  id: string;
  scenario_key: string;
  grade: string;
  stage_key: RelationshipStageKey;
  version: number;
  primary_goal: string;
  secondary_goal: string | null;
  strategy: unknown;
  recommended_memory_types: unknown;
  forbidden_patterns: unknown;
  response_style: unknown;
  expected_events: unknown;
};

const SCENARIO_COLUMNS = [
  "id",
  "scenario_key",
  "grade",
  "stage_key",
  "version",
  "primary_goal",
  "secondary_goal",
  "strategy",
  "recommended_memory_types",
  "forbidden_patterns",
  "response_style",
  "expected_events",
].join(", ");

const toStringArray = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
);

const toResolvedScenario = (row: RelationshipScenarioRow): ResolvedScenario => ({
  id: row.id,
  scenarioKey: row.scenario_key,
  grade: row.grade,
  stageKey: row.stage_key,
  version: row.version,
  primaryGoal: row.primary_goal,
  secondaryGoal: row.secondary_goal,
  strategy: row.strategy,
  recommendedMemoryTypes: toStringArray(row.recommended_memory_types),
  forbiddenPatterns: toStringArray(row.forbidden_patterns),
  responseStyle: row.response_style,
  expectedEvents: toStringArray(row.expected_events),
});

/**
 * Resolves the active scenario for one grade/stage session context.
 * Session-level caching belongs to the caller; this function always performs one read.
 */
export const resolveActiveScenario = async (
  db: SupabaseClient,
  grade: string,
  effectiveStage: RelationshipStageKey,
): Promise<ResolvedScenario | null> => {
  const { data, error } = await db
    .from("relationship_scenarios")
    .select(SCENARIO_COLUMNS)
    .eq("grade", grade)
    .eq("stage_key", effectiveStage)
    .eq("active", true)
    .order("version", { ascending: false })
    .returns<RelationshipScenarioRow[]>();

  if (error) {
    console.error("[scenarioResolver] 활성 시나리오 조회 실패:", {
      grade,
      stageKey: effectiveStage,
      error: error.message,
    });
    return null;
  }

  if (!data || data.length === 0) {
    console.error("[scenarioResolver] 활성 시나리오 없음:", {
      grade,
      stageKey: effectiveStage,
    });
    return null;
  }

  if (data.length > 1) {
    console.error("[scenarioResolver] 활성 시나리오 정합성 위반 감지:", {
      grade,
      stageKey: effectiveStage,
      scenarioCount: data.length,
      selectedVersion: data[0].version,
    });
  }

  return toResolvedScenario(data[0]);
};
