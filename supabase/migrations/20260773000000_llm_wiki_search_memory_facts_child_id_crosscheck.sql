-- codex 리뷰 지적: search_memory_facts가 memory_embeddings.child_id만 확인하고
-- memory_facts.child_id를 재확인하지 않았다 — 두 테이블의 child_id가 어떤 이유로든
-- 불일치하는 데이터가 생기면(버그·수동조작 등) 다른 아이의 fact가 노출될 수 있는
-- 구조였다. f.child_id도 명시적으로 검증한다(요청서 §8 "다른 아이 Memory 조회 금지"
-- 절대 조건).
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
    AND f.child_id = p_child_id
    AND f.status = 'active'
    AND 1 - (e.embedding <=> p_embedding) >= p_min_similarity
  ORDER BY e.embedding <=> p_embedding
  LIMIT p_top_k;
$$;

-- 같은 구조적 문제(child_id 교차확인 누락)가 find_similar_memory_fact(023 Step 3,
-- 재확인 판정용)에도 있어 같은 패턴으로 함께 수정한다.
CREATE OR REPLACE FUNCTION find_similar_memory_fact(
  p_child_id UUID,
  p_embedding VECTOR(768),
  p_fact_type TEXT,
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
    AND f.child_id = p_child_id
    AND f.fact_type = p_fact_type
    AND f.status IN ('candidate', 'active')
    AND 1 - (e.embedding <=> p_embedding) >= p_similarity_threshold
  ORDER BY e.embedding <=> p_embedding
  LIMIT 1;
$$;
