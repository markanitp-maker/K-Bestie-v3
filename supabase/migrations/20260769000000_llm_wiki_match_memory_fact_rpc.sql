-- 023 Step 3 준비 — supabase-js 쿼리 빌더는 pgvector의 <=> 연산자를 표현할 수 없어
-- RPC로 감싼다. candidate까지 포함해 검색해야 재확인 시 candidate→active 승격이
-- 가능하다(설계 문서 §3-4e, §4).
CREATE OR REPLACE FUNCTION find_similar_memory_fact(
  p_child_id UUID,
  p_embedding VECTOR(768),
  p_similarity_threshold FLOAT DEFAULT 0.92
)
RETURNS TABLE (fact_id UUID, similarity FLOAT)
LANGUAGE sql
STABLE
AS $$
  SELECT f.id AS fact_id, 1 - (e.embedding <=> p_embedding) AS similarity
  FROM memory_embeddings e
  JOIN memory_facts f ON f.id = e.memory_fact_id
  WHERE e.child_id = p_child_id
    AND f.status IN ('candidate', 'active')
    AND 1 - (e.embedding <=> p_embedding) >= p_similarity_threshold
  ORDER BY e.embedding <=> p_embedding
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION find_similar_memory_fact(UUID, VECTOR(768), FLOAT) TO service_role;
