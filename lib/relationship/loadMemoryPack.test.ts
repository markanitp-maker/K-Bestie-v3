import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ResolvedScenarioCard } from "./scenarioCard";
import { loadRelationshipMemoryPack } from "./loadMemoryPack";

function createMockScenarioCard(
  recommendedMemoryTypes: string[] = ["interest", "event"],
): ResolvedScenarioCard {
  return {
    scenarioKey: "G3_REMEMBER_V1",
    grade: 3,
    stageKey: "REMEMBER",
    version: "V1",
    stageCard: {
      stageKey: "REMEMBER",
      version: "V1",
      primaryGoal: "목표",
      secondaryGoal: "보조 목표",
      strategy: "전략",
      recommendedMemoryTypes: recommendedMemoryTypes as any,
      forbiddenPatterns: [],
      responseStyle: "응답 스타일",
      expectedEvents: [],
    },
    gradeStrategy: {
      grade: 3,
      label: "초3",
      vocabularyLevel: "쉬움",
      sentenceLength: "보통",
      questionLength: "보통",
      questionFrequency: "보통",
      initiativeRatio: 0.5,
      playfulness: "중간",
      emotionalDepth: "중간",
      memoryDirectness: "간접",
    },
  };
}

test("scenarioCard가 null이면 DB 검색 없이 빈 pack을 반환한다", async () => {
  let dbCalled = false;
  const mockDb = {} as SupabaseClient;

  const pack = await loadRelationshipMemoryPack({
    db: mockDb,
    childId: "child-1",
    queryText: "안녕",
    scenarioCard: null,
    dependencies: {
      searchMemory: async () => {
        dbCalled = true;
        return { status: "ok", facts: [] };
      },
    },
  });

  assert.equal(dbCalled, false);
  assert.deepEqual(pack, {
    facts: [],
    recommendedCount: 0,
    fallbackCount: 0,
    limit: 5,
  });
});

test("searchMemoryFactsDetailed 결과가 error여도 throw하지 않고 빈 pack을 반환한다", async () => {
  const mockDb = {} as SupabaseClient;
  const pack = await loadRelationshipMemoryPack({
    db: mockDb,
    childId: "child-1",
    queryText: "안녕",
    scenarioCard: createMockScenarioCard(),
    dependencies: {
      searchMemory: async () => ({
        status: "error",
        reason: "rpc_error",
      }),
    },
  });

  assert.deepEqual(pack, {
    facts: [],
    recommendedCount: 0,
    fallbackCount: 0,
    limit: 5,
  });
});

test("searchMemoryFactsDetailed 결과가 no_data이면 빈 pack을 반환한다", async () => {
  const mockDb = {} as SupabaseClient;
  const pack = await loadRelationshipMemoryPack({
    db: mockDb,
    childId: "child-1",
    queryText: "안녕",
    scenarioCard: createMockScenarioCard(),
    dependencies: {
      searchMemory: async () => ({
        status: "no_data",
      }),
    },
  });

  assert.deepEqual(pack, {
    facts: [],
    recommendedCount: 0,
    fallbackCount: 0,
    limit: 5,
  });
});

test("searchMemoryFactsDetailed 성공 시 권장 타입을 우선 배치한 Memory Pack을 반환한다", async () => {
  let capturedTopK = 0;
  const mockDb = {} as SupabaseClient;

  const pack = await loadRelationshipMemoryPack({
    db: mockDb,
    childId: "child-1",
    queryText: "안녕",
    scenarioCard: createMockScenarioCard(["interest"]),
    env: { RELATIONSHIP_MEMORY_PACK_LIMIT: "3" },
    dependencies: {
      searchMemory: async (_db, _childId, _queryText, topK) => {
        capturedTopK = topK ?? 0;
        return {
          status: "ok",
          facts: [
            {
              factId: "1",
              factType: "family",
              content: "가족",
              confidence: 0.9,
              importance: 0.8,
              sourceDate: "2026-08-16",
              sourceCount: 1,
              similarity: 0.9,
            },
            {
              factId: "2",
              factType: "interest",
              content: "공룡",
              confidence: 0.9,
              importance: 0.8,
              sourceDate: "2026-08-16",
              sourceCount: 1,
              similarity: 0.8,
            },
          ],
        };
      },
    },
  });

  assert.equal(capturedTopK, 6, "topK는 limit의 2배(3 * 2 = 6)여야 한다");
  assert.equal(pack.limit, 3);
  assert.equal(pack.recommendedCount, 1);
  assert.equal(pack.fallbackCount, 1);
  assert.equal(pack.facts[0].factId, "2"); // interest 우선
  assert.equal(pack.facts[1].factId, "1"); // family fallback
});

test("예외가 발생해도 throw하지 않고 빈 pack을 반환한다 (§27 fail-safe)", async () => {
  const mockDb = {} as SupabaseClient;
  const pack = await loadRelationshipMemoryPack({
    db: mockDb,
    childId: "child-1",
    queryText: "안녕",
    scenarioCard: createMockScenarioCard(),
    dependencies: {
      searchMemory: async () => {
        throw new Error("Critical DB network failure");
      },
    },
  });

  assert.deepEqual(pack, {
    facts: [],
    recommendedCount: 0,
    fallbackCount: 0,
    limit: 5,
  });
});
