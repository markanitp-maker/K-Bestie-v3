// Long-term Memory tier — memory_facts 벡터검색(LLM Wiki) 우선, 실패 시 child_memory(배치) fallback.
// lib/memory/vectorRetrieval.ts + lib/freechat/memoryRecallResponder.ts의 fallback 조회 로직을 재사용.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  searchMemoryFactsDetailed,
  type RetrievedMemoryFact,
} from "@/lib/memory/vectorRetrieval";

export interface LongTermMemoryResult {
  facts: RetrievedMemoryFact[];
  source: "memory_facts" | "child_memory" | "none";
}

const MAX_MEMORY_FACTS = 5;

/** 벡터검색 결과가 없으면(0건/에러) child_memory 배치 결과로 fallback한다.
 * child_memory는 RetrievedMemoryFact와 스키마가 달라 fact_type을 안전한 기본값으로 매핑한다. */
export async function fetchLongTermMemory(
  db: SupabaseClient,
  childId: string,
  queryText: string,
): Promise<LongTermMemoryResult> {
  const vectorResult = await searchMemoryFactsDetailed(db, childId, queryText, MAX_MEMORY_FACTS);
  if (vectorResult.status === "ok" && vectorResult.facts.length > 0) {
    return { facts: vectorResult.facts.slice(0, MAX_MEMORY_FACTS), source: "memory_facts" };
  }

  try {
    const nowIso = new Date().toISOString();
    const [longTermSettled, shortTermSettled] = await Promise.allSettled([
      db
        .from("child_memory")
        .select("id, memory_type, category, content, business_date")
        .eq("child_id", childId)
        .eq("memory_type", "long_term")
        .order("business_date", { ascending: false })
        .limit(MAX_MEMORY_FACTS),
      db
        .from("child_memory")
        .select("id, memory_type, category, content, business_date")
        .eq("child_id", childId)
        .eq("memory_type", "short_term")
        .gt("expires_at", nowIso)
        .order("business_date", { ascending: false })
        .limit(MAX_MEMORY_FACTS),
    ]);

    const rows = [
      ...(longTermSettled.status === "fulfilled" && !longTermSettled.value.error
        ? longTermSettled.value.data ?? []
        : []),
      ...(shortTermSettled.status === "fulfilled" && !shortTermSettled.value.error
        ? shortTermSettled.value.data ?? []
        : []),
    ];
    if (rows.length === 0) return { facts: [], source: "none" };

    // child_memory는 memory_facts와 달리 confidence/importance/similarity 점수가 없다 —
    // RetrievedMemoryFact 필수 필드를 채우기 위해 "배치 요약이므로 신뢰 가능"을 뜻하는
    // 보수적 기본값을 쓴다(벡터 유사도로 랭킹된 값이 아니므로 similarity=0).
    const facts: RetrievedMemoryFact[] = rows.map((row) => ({
      factId: row.id,
      factType: (row.category as RetrievedMemoryFact["factType"]) ?? "trait",
      content: row.content,
      confidence: 0.5,
      importance: 0.5,
      sourceDate: row.business_date,
      sourceCount: 1,
      similarity: 0,
    }));
    return { facts: facts.slice(0, MAX_MEMORY_FACTS), source: "child_memory" };
  } catch (error) {
    console.error("[k-conversation/memory/longTerm] child_memory fallback failed", (error as Error).message);
    return { facts: [], source: "none" };
  }
}
