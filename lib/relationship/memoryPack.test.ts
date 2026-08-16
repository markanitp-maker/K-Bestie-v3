import assert from "node:assert/strict";
import test from "node:test";

import type { RetrievedMemoryFact } from "@/lib/memory/vectorRetrieval";
import { buildRelationshipMemoryPack } from "./memoryPack";

function createMockFact(
  factId: string,
  factType: string,
  content: string,
): RetrievedMemoryFact {
  return {
    factId,
    factType,
    content,
    confidence: 0.9,
    importance: 0.8,
    sourceDate: "2026-08-16",
    sourceCount: 1,
    similarity: 0.85,
  };
}

test("권장 타입이 앞에 오고, 각 그룹 내부 순서는 입력 순서(유사도 랭킹)를 그대로 유지한다", () => {
  const f1 = createMockFact("1", "family", "엄마와 여행");
  const f2 = createMockFact("2", "interest", "공룡을 좋아함");
  const f3 = createMockFact("3", "friend", "민수와 친함");
  const f4 = createMockFact("4", "event", "축구 경기 관람");
  const f5 = createMockFact("5", "interest", "레고 조립");

  const inputFacts = [f1, f2, f3, f4, f5];
  const recommendedTypes = ["interest", "event"];

  const pack = buildRelationshipMemoryPack({
    facts: inputFacts,
    recommendedTypes,
    limit: 4,
  });

  assert.equal(pack.limit, 4);
  assert.equal(pack.recommendedCount, 3); // f2(interest), f4(event), f5(interest)
  assert.equal(pack.fallbackCount, 1); // f1(family)
  assert.equal(pack.facts.length, 4);

  // 권장 타입 그룹(f2, f4, f5)이 먼저, 그 다음 fallback 그룹(f1)
  assert.deepEqual(pack.facts, [f2, f4, f5, f1]);
});

test("권장 타입이 부족하면 다른 타입으로 limit까지 채우고 fallbackCount가 정확하다", () => {
  const f1 = createMockFact("1", "family", "동생이 있음");
  const f2 = createMockFact("2", "interest", "우주를 좋아함");
  const f3 = createMockFact("3", "friend", "지우와 짝꿍");

  const pack = buildRelationshipMemoryPack({
    facts: [f1, f2, f3],
    recommendedTypes: ["interest", "event"],
    limit: 3,
  });

  assert.equal(pack.recommendedCount, 1); // f2
  assert.equal(pack.fallbackCount, 2); // f1, f3
  assert.deepEqual(pack.facts, [f2, f1, f3]);
});

test("권장 타입이 빈 배열이면(= MEET 단계) 입력 순서 그대로 limit까지 담긴다", () => {
  const f1 = createMockFact("1", "family", "가족 이야기");
  const f2 = createMockFact("2", "interest", "관심사 이야기");
  const f3 = createMockFact("3", "friend", "친구 이야기");

  const pack = buildRelationshipMemoryPack({
    facts: [f1, f2, f3],
    recommendedTypes: [],
    limit: 2,
  });

  assert.equal(pack.recommendedCount, 0);
  assert.equal(pack.fallbackCount, 2);
  assert.deepEqual(pack.facts, [f1, f2]);
});

test("limit보다 fact가 적으면 있는 만큼만 반환한다", () => {
  const f1 = createMockFact("1", "interest", "그림 그리기");
  const f2 = createMockFact("2", "friend", "영희");

  const pack = buildRelationshipMemoryPack({
    facts: [f1, f2],
    recommendedTypes: ["interest"],
    limit: 5,
  });

  assert.equal(pack.recommendedCount, 1);
  assert.equal(pack.fallbackCount, 1);
  assert.equal(pack.facts.length, 2);
  assert.deepEqual(pack.facts, [f1, f2]);
});

test("limit이 0 또는 음수이면 빈 pack을 반환한다", () => {
  const f1 = createMockFact("1", "interest", "독서");

  const pack0 = buildRelationshipMemoryPack({
    facts: [f1],
    recommendedTypes: ["interest"],
    limit: 0,
  });
  assert.deepEqual(pack0, {
    facts: [],
    recommendedCount: 0,
    fallbackCount: 0,
    limit: 0,
  });

  const packNeg = buildRelationshipMemoryPack({
    facts: [f1],
    recommendedTypes: ["interest"],
    limit: -1,
  });
  assert.deepEqual(packNeg, {
    facts: [],
    recommendedCount: 0,
    fallbackCount: 0,
    limit: -1,
  });
});

test("입력 배열이 변형되지 않는다 (호출 전후 원본 비교 및 불변성)", () => {
  const f1 = createMockFact("1", "family", "가족");
  const f2 = createMockFact("2", "interest", "게임");
  const f3 = createMockFact("3", "friend", "친구");
  const inputFacts = [f1, f2, f3];
  const inputFactsSnapshot = [f1, f2, f3];

  buildRelationshipMemoryPack({
    facts: inputFacts,
    recommendedTypes: ["interest"],
    limit: 2,
  });

  assert.deepEqual(inputFacts, inputFactsSnapshot);
  assert.equal(inputFacts[0], f1);
  assert.equal(inputFacts[1], f2);
  assert.equal(inputFacts[2], f3);
});

test("중복된 factId가 존재해도 pack에는 중복 없이 1회만 담긴다", () => {
  const f1 = createMockFact("dup1", "interest", "축구");
  const f2 = createMockFact("dup1", "interest", "축구 (중복 factId)");
  const f3 = createMockFact("dup1", "family", "축구 (다른 타입이지만 동일 factId)");
  const f4 = createMockFact("unique2", "friend", "철수");

  const pack = buildRelationshipMemoryPack({
    facts: [f1, f2, f3, f4],
    recommendedTypes: ["interest"],
    limit: 4,
  });

  assert.equal(pack.facts.length, 2);
  assert.equal(pack.recommendedCount, 1);
  assert.equal(pack.fallbackCount, 1);
  assert.deepEqual(pack.facts, [f1, f4]);
});
