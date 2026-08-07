// 023 LLM Wiki + RAG Memory — Step 5 Vector Retrieval(설계 문서 §5).
// 이 파일은 "관련 있는 memory_facts를 검색해서 문자열로 포맷"까지만 담당한다.
// 실패/결과 0건이면 null을 반환해, 호출부가 기존 child_memory recency 조회로
// fallback하도록 한다(요청서 §8 "방식 제거하지 말고 fallback으로 유지").

import { SupabaseClient } from "@supabase/supabase-js";
import { createGenAIClient } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";

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

async function embedQuery(db: SupabaseClient, childId: string, text: string): Promise<number[] | null> {
  try {
    const ai = createGenAIClient({ provider: "vertex" });
    const embeddingModel = getLlmModel("embedding");
    const response = await ai.models.embedContent({
      model: embeddingModel,
      contents: text,
      config: { taskType: "RETRIEVAL_QUERY", outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    const values = response.embeddings?.[0]?.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) return null;
    const { error: usageError } = await db.from("usage_events").insert({
      child_id: childId,
      kind: "embedding",
      model: embeddingModel,
      request_count: 1,
      input_count: text.length,
      est_cost_krw: null,
      environment: process.env.NEXT_PUBLIC_SUPABASE_TARGET === "prod" ? "production" : "development",
    });
    if (usageError) {
      console.error("[vectorRetrieval] embedding usage 기록 실패:", usageError.message);
    }
    return values;
  } catch (err) {
    console.error("[vectorRetrieval] 임베딩 생성 실패(fallback 예정):", err);
    return null;
  }
}

function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export type SearchMemoryFactsResult =
  | { status: "ok"; facts: RetrievedMemoryFact[] }
  | { status: "no_data" }
  | { status: "error"; reason: string };

/** searchMemoryFacts의 상세 버전 — "실패"와 "정상 조회했으나 0건"을 구분해서
 *  반환한다(requests/request-parent-k-chat-intent-routing-fallback-fix.md §6/§9 —
 *  RETRIEVAL_ERROR를 NO_DATA로 위장하지 않는다). */
export async function searchMemoryFactsDetailed(
  db: SupabaseClient,
  childId: string,
  queryText: string,
  topK = 5,
): Promise<SearchMemoryFactsResult> {
  const embedding = await embedQuery(db, childId, queryText);
  if (!embedding) return { status: "error", reason: "embedding_failed" };

  try {
    const { data, error } = await db.rpc("search_memory_facts", {
      p_child_id: childId,
      p_embedding: toPgVectorLiteral(embedding),
      p_top_k: topK,
    });
    if (error) {
      console.error("[vectorRetrieval] search_memory_facts RPC 실패:", error.message);
      return { status: "error", reason: "rpc_error" };
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return { status: "no_data" };

    return {
      status: "ok",
      facts: rows.map((r: any) => ({
        factId: r.fact_id,
        factType: r.fact_type,
        content: r.content,
        confidence: r.confidence,
        importance: r.importance,
        sourceDate: r.source_date,
        sourceCount: r.source_count,
        similarity: r.similarity,
      })),
    };
  } catch (err) {
    console.error("[vectorRetrieval] search_memory_facts 예외:", err);
    return { status: "error", reason: "exception" };
  }
}

/** queryText와 관련 있는 아이의 active memory_facts를 top_k개 검색.
 *  임베딩/RPC 실패 또는 결과 0건이면 null(호출부는 이때 기존 recency 조회로 fallback).
 *  실패와 0건을 구분해야 하면 searchMemoryFactsDetailed를 사용한다. */
export async function searchMemoryFacts(
  db: SupabaseClient,
  childId: string,
  queryText: string,
  topK = 5,
): Promise<RetrievedMemoryFact[] | null> {
  const result = await searchMemoryFactsDetailed(db, childId, queryText, topK);
  return result.status === "ok" ? result.facts : null;
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
