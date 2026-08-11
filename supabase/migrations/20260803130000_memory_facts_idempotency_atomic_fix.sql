-- P0 긴급수정 (안서현 부모-케이 장애) — memory_facts.idempotency_key가 포지션(그날
-- Gemini 응답 배열에서의 순번) 기반이라, 동일 날짜 재실행/실패 후 재시도/동시 실행
-- 시 완전히 다른 의미의 Fact가 이전 실행과 같은 인덱스 자리에 와서
-- uq_memory_facts_idempotency_key 유니크 제약을 건드리고, 이 예외가 그대로
-- throw돼 해당 아이의 그날 Memory Batch 전체가 실패했다.
--
-- 수정 방향:
--  1) idempotency_key를 내용 기반(해시)으로 바꾼다(batch.ts에서 수행) — 같은 내용은
--     같은 키, 다른 내용은 절대 같은 키가 될 수 없다.
--  2) Fact·Evidence·Embedding·History 4개 INSERT를 단일 RPC(하나의 트랜잭션)로
--     묶어, 부분 실패로 Fact만 있고 Evidence/Embedding이 없는 고아 데이터가
--     생기지 않게 한다.
--  3) 동시 실행 등으로 동일 idempotency_key가 경합해도 ON CONFLICT로 안전하게
--     기존 fact_id를 반환하고 중복 생성을 만들지 않는다.
--
-- ON CONFLICT ON CONSTRAINT는 실제 pg_constraint 항목이 필요해 단순 UNIQUE INDEX는
-- 대상으로 쓸 수 없다 — 기존 partial index를 동일 이름의 UNIQUE CONSTRAINT로
-- 교체한다. NULL은 유니크 제약에서 여전히 서로 중복으로 취급되지 않으므로(표준 SQL
-- 동작) 기존에 idempotency_key가 NULL인 백필 이전 행들의 동작은 변하지 않고, 기존
-- non-null 값들은 이미 partial index가 유일함을 보장했으므로 이 교체는 실패할 수
-- 없다(선행 검증: 아래 DO 블록에서 재확인 후 진행).

DO $$
DECLARE
  v_dupe_count INT;
BEGIN
  SELECT COUNT(*) INTO v_dupe_count
  FROM (
    SELECT idempotency_key FROM public.memory_facts
    WHERE idempotency_key IS NOT NULL
    GROUP BY idempotency_key
    HAVING COUNT(*) > 1
  ) dupes;
  IF v_dupe_count > 0 THEN
    RAISE EXCEPTION 'memory_facts.idempotency_key에 중복 % 건 존재 — UNIQUE CONSTRAINT 전환 중단', v_dupe_count;
  END IF;
END $$;

-- Dev에서 이 이름이 이미 UNIQUE CONSTRAINT(단순 INDEX가 아님)로 out-of-band 전환돼
-- 있는 경우 DROP INDEX가 2BP01로 실패하므로, 이미 제약으로 존재하면 건너뛴다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_memory_facts_idempotency_key'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS uq_memory_facts_idempotency_key';
    EXECUTE 'ALTER TABLE public.memory_facts ADD CONSTRAINT uq_memory_facts_idempotency_key UNIQUE (idempotency_key)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION create_memory_fact_with_evidence(
  p_idempotency_key TEXT,
  p_child_id UUID,
  p_fact_type TEXT,
  p_subject TEXT,
  p_content TEXT,
  p_confidence NUMERIC,
  p_importance NUMERIC,
  p_status TEXT,
  p_source_type TEXT,
  p_source_date DATE,
  p_session_type TEXT,
  p_model_version TEXT,
  p_prompt_version TEXT,
  p_pipeline_version TEXT,
  p_evidence_summary TEXT,
  p_source_text TEXT,
  p_embedding VECTOR(768),
  p_embedding_model TEXT
)
RETURNS TABLE (fact_id UUID, was_new BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_fact_id UUID;
  v_was_new BOOLEAN := false;
BEGIN
  INSERT INTO memory_facts (
    child_id, fact_type, subject, content, confidence, importance, status,
    source_type, source_date, session_type, model_version, prompt_version,
    pipeline_version, idempotency_key, backfill_status
  ) VALUES (
    p_child_id, p_fact_type, p_subject, p_content, p_confidence, p_importance, p_status,
    p_source_type, p_source_date, p_session_type, p_model_version, p_prompt_version,
    p_pipeline_version, p_idempotency_key, 'normal'
  )
  ON CONFLICT ON CONSTRAINT uq_memory_facts_idempotency_key DO NOTHING
  RETURNING id INTO v_fact_id;

  IF v_fact_id IS NOT NULL THEN
    v_was_new := true;

    INSERT INTO memory_evidence (memory_fact_id, evidence_summary, source_text, source_date)
    VALUES (v_fact_id, p_evidence_summary, p_source_text, p_source_date);

    INSERT INTO memory_embeddings (memory_fact_id, child_id, embedding, model)
    VALUES (v_fact_id, p_child_id, p_embedding, p_embedding_model);

    INSERT INTO memory_history (memory_id, action, after_value)
    VALUES (v_fact_id, 'created', jsonb_build_object('fact_type', p_fact_type, 'status', p_status));
  ELSE
    -- 동시 실행/재시도로 동일 idempotency_key가 이미 존재 — 기존 fact_id를 그대로
    -- 반환해 호출부가 중복 생성 없이 처리를 종료할 수 있게 한다.
    SELECT id INTO v_fact_id FROM memory_facts WHERE idempotency_key = p_idempotency_key;
  END IF;

  RETURN QUERY SELECT v_fact_id, v_was_new;
END;
$$;

GRANT EXECUTE ON FUNCTION create_memory_fact_with_evidence(
  TEXT, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, VECTOR(768), TEXT
) TO service_role;
