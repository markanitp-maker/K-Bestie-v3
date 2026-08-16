import type { RetrievedMemoryFact } from "@/lib/memory/vectorRetrieval";

export interface RelationshipMemoryPack {
  facts: RetrievedMemoryFact[];
  /** 권장 타입에서 채워진 개수. 관측용. */
  recommendedCount: number;
  /** 권장 타입이 부족해 다른 타입으로 채운 개수. 관측용. */
  fallbackCount: number;
  limit: number;
}

/**
 * 순수 함수. DB를 부르지 않는다 — 테스트 가능하게 유지한다.
 *
 * 규칙:
 * - 권장 타입에 해당하는 fact를 받은 순서 그대로 먼저 담는다.
 * - limit이 남으면 나머지 fact를 받은 순서 그대로 이어서 담는다.
 * - recommendedTypes가 빈 배열이면(= MEET 단계) 그냥 받은 순서대로 limit까지 담는다.
 * - 같은 factId가 두 번 들어가지 않게 한다.
 * - limit이 0 이하면 빈 pack.
 * - 입력 배열을 변형하지 않는다.
 */
export function buildRelationshipMemoryPack(input: {
  facts: RetrievedMemoryFact[];
  recommendedTypes: readonly string[];
  limit: number;
}): RelationshipMemoryPack {
  const { facts, recommendedTypes, limit } = input;

  if (limit <= 0) {
    return {
      facts: [],
      recommendedCount: 0,
      fallbackCount: 0,
      limit,
    };
  }

  const recommendedSet = new Set(recommendedTypes);
  const seenFactIds = new Set<string>();
  const recommendedFacts: RetrievedMemoryFact[] = [];

  // 1. 권장 타입에 해당하는 fact를 받은 순서 그대로 먼저 담는다.
  if (recommendedSet.size > 0) {
    for (const fact of facts) {
      if (recommendedFacts.length >= limit) break;
      if (recommendedSet.has(fact.factType) && !seenFactIds.has(fact.factId)) {
        recommendedFacts.push(fact);
        seenFactIds.add(fact.factId);
      }
    }
  }

  // 2. limit이 남으면 나머지 fact를 받은 순서 그대로 이어서 담는다.
  const fallbackFacts: RetrievedMemoryFact[] = [];
  if (recommendedFacts.length < limit) {
    for (const fact of facts) {
      if (recommendedFacts.length + fallbackFacts.length >= limit) break;
      if (!seenFactIds.has(fact.factId)) {
        fallbackFacts.push(fact);
        seenFactIds.add(fact.factId);
      }
    }
  }

  return {
    facts: [...recommendedFacts, ...fallbackFacts],
    recommendedCount: recommendedFacts.length,
    fallbackCount: fallbackFacts.length,
    limit,
  };
}
