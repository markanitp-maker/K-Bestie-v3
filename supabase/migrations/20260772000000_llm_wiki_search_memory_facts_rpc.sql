-- 023 Step 5 — Vector Retrieval. 설계 문서 §5. status='active'만 대상(candidate/stale/
-- superseded/invalidated/rejected는 검색 제외). find_similar_memory_fact(재확인 판정용,
-- fact_type 고정 비교)와는 목적이 다르다 — 이 RPC는 "관련성 있는 기억을 top_k개 가져오기"
-- 용도라 fact_type을 제한하지 않는다(여러 유형이 섞여서 나올 수 있음, 의도된 동작).
CREATE OR REPLACE FUNCTION search_memory_facts(
  p_child_id UUID,
  p_embedding VECTOR(768),
  p_top_k INT DEFAULT 5,
  p_min_similarity FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  fact_id UUID,
  fact_type TEXT,
  content TEXT,
  confidence NUMERIC,
  importance NUMERIC,
  source_date DATE,
  source_count INT,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT f.id AS fact_id, f.fact_type, f.content, f.confidence, f.importance,
         f.source_date, f.source_count, 1 - (e.embedding <=> p_embedding) AS similarity
  FROM memory_embeddings e
  JOIN memory_facts f ON f.id = e.memory_fact_id
  WHERE e.child_id = p_child_id
    AND f.status = 'active'
    AND 1 - (e.embedding <=> p_embedding) >= p_min_similarity
  ORDER BY e.embedding <=> p_embedding
  LIMIT p_top_k;
$$;

GRANT EXECUTE ON FUNCTION search_memory_facts(UUID, VECTOR(768), INT, FLOAT) TO service_role;
