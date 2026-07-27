-- codex 리뷰 지적: find_similar_memory_fact가 child_id와 status만 제한하고 fact_type을
-- 비교하지 않아, 내용이 유사한 서로 다른 타입이 재확인으로 잘못 합쳐질 수 있었다(특히
-- trait/pattern이 기존 일반 active fact에 흡수되면 candidate 게이트가 우회됨). fact_type
-- 조건을 추가한다.
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
    AND f.fact_type = p_fact_type
    AND f.status IN ('candidate', 'active')
    AND 1 - (e.embedding <=> p_embedding) >= p_similarity_threshold
  ORDER BY e.embedding <=> p_embedding
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION find_similar_memory_fact(UUID, VECTOR(768), TEXT, FLOAT) TO service_role;

-- 기존 (child_id, embedding, threshold) 4-인자 시그니처는 더 이상 코드에서 호출하지 않으므로
-- 제거한다(그대로 두면 오버로드로 남아 실수로 옛 시그니처가 호출될 위험이 있음).
DROP FUNCTION IF EXISTS find_similar_memory_fact(UUID, VECTOR(768), FLOAT);
