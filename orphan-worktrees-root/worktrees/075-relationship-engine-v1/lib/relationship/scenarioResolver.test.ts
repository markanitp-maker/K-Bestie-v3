import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveActiveScenario } from "./scenarioResolver";
import type { RelationshipStageKey } from "./effectiveStage";

type ScenarioRow = {
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

const createScenario = (
  grade: string,
  stageKey: RelationshipStageKey,
  version = 1,
): ScenarioRow => ({
  id: `${grade}-${stageKey}-${version}`,
  scenario_key: `G${grade}_${stageKey}_V${version}`,
  grade,
  stage_key: stageKey,
  version,
  primary_goal: "관계 목표",
  secondary_goal: "보조 목표",
  strategy: { approach: "listen" },
  recommended_memory_types: ["preference"],
  forbidden_patterns: ["privacy_probe"],
  response_style: { tone: "warm" },
  expected_events: ["conversation_started"],
});

const createMockDb = (rows: ScenarioRow[]): SupabaseClient => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    returns: async <T>() => ({ data: rows as T, error: null }),
  };

  return {
    from: () => query,
  } as unknown as SupabaseClient;
};

const captureConsoleError = async (run: () => Promise<void>): Promise<unknown[][]> => {
  const originalConsoleError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };

  try {
    await run();
  } finally {
    console.error = originalConsoleError;
  }

  return calls;
};

test("활성 scenario 한 건을 ResolvedScenario로 변환한다", async () => {
  const result = await resolveActiveScenario(createMockDb([createScenario("3", "REMEMBER")]), "3", "REMEMBER");

  assert.deepEqual(result, {
    id: "3-REMEMBER-1",
    scenarioKey: "G3_REMEMBER_V1",
    grade: "3",
    stageKey: "REMEMBER",
    version: 1,
    primaryGoal: "관계 목표",
    secondaryGoal: "보조 목표",
    strategy: { approach: "listen" },
    recommendedMemoryTypes: ["preference"],
    forbiddenPatterns: ["privacy_probe"],
    responseStyle: { tone: "warm" },
    expectedEvents: ["conversation_started"],
  });
});

test("활성 scenario가 없으면 null과 grade/stage 로그를 반환한다", async () => {
  let result: Awaited<ReturnType<typeof resolveActiveScenario>>;
  const errorCalls = await captureConsoleError(async () => {
    result = await resolveActiveScenario(createMockDb([]), "2", "MEET");
  });

  assert.equal(result!, null);
  assert.equal(errorCalls.length, 1);
  assert.match(String(errorCalls[0][0]), /활성 시나리오 없음/);
  assert.deepEqual(errorCalls[0][1], { grade: "2", stageKey: "MEET" });
});

test("활성 scenario가 둘 이상이면 최신 version을 선택하고 정합성 위반을 로그한다", async () => {
  let result: Awaited<ReturnType<typeof resolveActiveScenario>>;
  const errorCalls = await captureConsoleError(async () => {
    result = await resolveActiveScenario(
      createMockDb([createScenario("4", "SHARED_HISTORY", 2), createScenario("4", "SHARED_HISTORY", 1)]),
      "4",
      "SHARED_HISTORY",
    );
  });

  assert.equal(result!.version, 2);
  assert.equal(errorCalls.length, 1);
  assert.match(String(errorCalls[0][0]), /정합성 위반 감지/);
  assert.deepEqual(errorCalls[0][1], {
    grade: "4",
    stageKey: "SHARED_HISTORY",
    scenarioCount: 2,
    selectedVersion: 2,
  });
});

test("mock seed의 G1~G6 × 모든 stage 조합은 각각 정확히 한 건을 resolve한다", async () => {
  // Phase 2 seed DB를 조회하지 않는 mock 데이터 테스트다.
  const grades = ["1", "2", "3", "4", "5", "6"];
  const stages: RelationshipStageKey[] = ["MEET", "REMEMBER", "SHARED_HISTORY", "VOLUNTARY_RETURN"];
  const scenarios = grades.flatMap((grade) => stages.map((stage) => createScenario(grade, stage)));

  for (const grade of grades) {
    for (const stage of stages) {
      const matchingScenario = scenarios.filter((scenario) => scenario.grade === grade && scenario.stage_key === stage);
      const result = await resolveActiveScenario(createMockDb(matchingScenario), grade, stage);

      assert.equal(matchingScenario.length, 1);
      assert.equal(result?.scenarioKey, `G${grade}_${stage}_V1`);
      assert.equal(result?.grade, grade);
      assert.equal(result?.stageKey, stage);
    }
  }
});
