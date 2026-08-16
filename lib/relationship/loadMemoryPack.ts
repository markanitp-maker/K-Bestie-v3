import type { SupabaseClient } from "@supabase/supabase-js";
import {
  searchMemoryFactsDetailed,
  type RetrievedMemoryFact,
  type SearchMemoryFactsResult,
} from "@/lib/memory/vectorRetrieval";
import type { ResolvedScenarioCard } from "./scenarioCard";
import {
  buildRelationshipMemoryPack,
  type RelationshipMemoryPack,
} from "./memoryPack";
import { loadRelationshipMemoryPackLimit } from "./memoryPackConfig";

export type MemorySearchFunction = (
  db: SupabaseClient,
  childId: string,
  queryText: string,
  topK?: number,
) => Promise<SearchMemoryFactsResult>;

export interface LoadRelationshipMemoryPackInput {
  db: SupabaseClient;
  childId: string;
  queryText: string;
  scenarioCard: ResolvedScenarioCard | null;
  env?: NodeJS.ProcessEnv;
  dependencies?: {
    searchMemory?: MemorySearchFunction;
  };
}

/**
 * 세션 시작 시 1회 호출(§13).
 * 실패해도 절대 throw 하지 않는다(§27 fail-safe).
 */
export async function loadRelationshipMemoryPack(
  input: LoadRelationshipMemoryPackInput,
): Promise<RelationshipMemoryPack> {
  const limit = loadRelationshipMemoryPackLimit(input.env);

  // scenarioCard가 null이면 검색을 아예 하지 않고 빈 pack을 돌려준다.
  if (!input.scenarioCard) {
    return {
      facts: [],
      recommendedCount: 0,
      fallbackCount: 0,
      limit,
    };
  }

  try {
    const recommendedTypes = input.scenarioCard.stageCard.recommendedMemoryTypes;

    // RPC search_memory_facts는 fact_type 필터링 파라미터가 없는 순수 유사도 검색이므로,
    // RPC 단계에서 권장 memory_type을 가진 fact를 충분히 확보하기 위해 topK를 limit의 2배(limit * 2)로 넉넉하게 요청한다.
    const topK = limit * 2;

    const searchMemory = input.dependencies?.searchMemory ?? searchMemoryFactsDetailed;
    const result = await searchMemory(
      input.db,
      input.childId,
      input.queryText,
      topK,
    );

    if (result.status === "error") {
      console.error(
        "[loadMemoryPack] searchMemoryFactsDetailed 실패(빈 팩 fallback):",
        result.reason,
      );
      return {
        facts: [],
        recommendedCount: 0,
        fallbackCount: 0,
        limit,
      };
    }

    if (result.status === "no_data") {
      return {
        facts: [],
        recommendedCount: 0,
        fallbackCount: 0,
        limit,
      };
    }

    const facts: RetrievedMemoryFact[] = result.facts;
    return buildRelationshipMemoryPack({
      facts,
      recommendedTypes,
      limit,
    });
  } catch (error) {
    // §27: 관계 기억 조회 예외가 아이의 전체 대화 시작을 막지 않도록 빈 팩으로 안전 복구
    console.error("[loadMemoryPack] 예외 발생(빈 팩 fallback):", error);
    return {
      facts: [],
      recommendedCount: 0,
      fallbackCount: 0,
      limit,
    };
  }
}
