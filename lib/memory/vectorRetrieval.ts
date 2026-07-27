// 023 LLM Wiki + RAG Memory — Step 5 Vector Retrieval(설계 문서 §5).
// 이 파일은 "관련 있는 memory_facts를 검색해서 문자열로 포맷"까지만 담당한다.
// 실패/결과 0건이면 null을 반환해, 호출부가 기존 child_memory recency 조회로
// fallback하도록 한다(요청서 §8 "방식 제거하지 말고 fallback으로 유지").

import { SupabaseClient } from "@supabase/supabase-js";
import { createGenAIClient } from "@/app/api/_lib/ai";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

export interface RetrievedMemoryFact {
  factId: string;
  factType: string;
  content: string;
  confidence: number;
  importance: number;
  sourceDate: string;
  sourceCount: number;
  similarity: number;
}

async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const ai = createGenAIClient({ provider: "vertex" });
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { taskType: "RETRIEVAL_QUERY", outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    const values = response.embeddings?.[0]?.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) return null;
    return values;
  } catch (err) {
    console.error("[vectorRetrieval] 임베딩 생성 실패(fallback 예정):", err);
    return null;
  }
}

function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

/** queryText와 관련 있는 아이의 active memory_facts를 top_k개 검색.
 *  임베딩/RPC 실패 또는 결과 0건이면 null(호출부는 이때 기존 recency 조회로 fallback). */
export async function searchMemoryFacts(
  db: SupabaseClient,
  childId: string,
  queryText: string,
  topK = 5,
): Promise<RetrievedMemoryFact[] | null> {
  const embedding = await embedQuery(queryText);
  if (!embedding) return null;

  try {
    const { data, error } = await db.rpc("search_memory_facts", {
      p_child_id: childId,
      p_embedding: toPgVectorLiteral(embedding),
      p_top_k: topK,
    });
    if (error) {
      console.error("[vectorRetrieval] search_memory_facts RPC 실패(fallback 예정):", error.message);
      return null;
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return null;

    return rows.map((r: any) => ({
      factId: r.fact_id,
      factType: r.fact_type,
      content: r.content,
      confidence: r.confidence,
      importance: r.importance,
      sourceDate: r.source_date,
      sourceCount: r.source_count,
      similarity: r.similarity,
    }));
  } catch (err) {
    console.error("[vectorRetrieval] search_memory_facts 예외(fallback 예정):", err);
    return null;
  }
}

/** 프롬프트 주입용 문자열 포맷 — 근거 메타데이터 포함(설계 문서 §6 예시 형태). */
export function formatMemoryFactsForPrompt(facts: RetrievedMemoryFact[]): string {
  return facts
    .map(
      (f) =>
        `[신뢰도 ${f.confidence.toFixed(2)}] ${f.content}(${f.sourceDate} 최초 확인, ${f.sourceCount}회 재확인)`,
    )
    .join("\n");
}
