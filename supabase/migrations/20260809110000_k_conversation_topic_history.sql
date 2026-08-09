-- 071 K Conversation Engine — Semantic Topic History (§9).
-- 질문 ID가 달라도 의미가 같으면 같은 semantic_group으로 묶어 반복을 감지하고,
-- K가 먼저 같은 주제를 다시 꺼내는 것만 제한한다(아이가 먼저 꺼내는 건 제한 없음).
-- Mission/자유대화가 공유하는 071 공통 모듈 소유 테이블 — 073 Mission Adapter는 읽기/쓰기만 하고
-- 스키마를 복제하지 않는다.

CREATE TABLE IF NOT EXISTS conversation_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  semantic_group TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('mission', 'free_chat')),
  -- 마지막으로 이 주제를 꺼낸 쪽(참고용 표시). 누적 빈도는 child_frequency/k_frequency로 별도 보존한다
  -- (codex-rv 지적: 단일 컬럼 덮어쓰기로는 child/K 각각의 이력이 사라짐).
  last_initiated_by TEXT NOT NULL CHECK (last_initiated_by IN ('child', 'k', 'parent_question')),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  child_frequency INT NOT NULL DEFAULT 0,
  k_frequency INT NOT NULL DEFAULT 0,
  parent_question_frequency INT NOT NULL DEFAULT 0,
  cooldown_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 아이 1명당 semantic_group 1행만 유지(최신 사용 시점/빈도로 계속 갱신) — 반복 이력을 무한히 쌓지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_topics_child_group
  ON conversation_topics(child_id, semantic_group);

CREATE INDEX IF NOT EXISTS idx_conversation_topics_child_cooldown
  ON conversation_topics(child_id, cooldown_until);

ALTER TABLE conversation_topics ENABLE ROW LEVEL SECURITY;

-- 서비스 롤 전용(다른 K-Bestie 대화 테이블과 동일 패턴) — 아이/부모 클라이언트는 직접 접근하지 않고
-- 항상 서버 API를 경유한다. anon/authenticated GRANT는 하드룰(AGENTS.md §5)에 따라 부여하되
-- 실제 행 접근은 RLS로 서비스 롤 전용으로 막는다.
GRANT ALL ON conversation_topics TO anon, authenticated;

CREATE POLICY "conversation_topics_service_only"
  ON conversation_topics FOR ALL
  USING (false)
  WITH CHECK (false);

-- 원자적 upsert RPC — codex-rv 지적: read-modify-write(select 후 update)는 동시 호출 시
-- 증분이 유실된다. INSERT ... ON CONFLICT DO UPDATE로 단일 쿼리에서 원자적으로 처리한다.
CREATE OR REPLACE FUNCTION record_conversation_topic_usage(
  p_child_id UUID,
  p_semantic_group TEXT,
  p_mode TEXT,
  p_initiated_by TEXT,
  p_cooldown_days INT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO conversation_topics (
    child_id, semantic_group, mode, last_initiated_by, last_used_at,
    child_frequency, k_frequency, parent_question_frequency, cooldown_until
  )
  VALUES (
    p_child_id, p_semantic_group, p_mode, p_initiated_by, now(),
    CASE WHEN p_initiated_by = 'child' THEN 1 ELSE 0 END,
    CASE WHEN p_initiated_by = 'k' THEN 1 ELSE 0 END,
    CASE WHEN p_initiated_by = 'parent_question' THEN 1 ELSE 0 END,
    now() + (p_cooldown_days || ' days')::interval
  )
  ON CONFLICT (child_id, semantic_group) DO UPDATE SET
    mode = EXCLUDED.mode,
    last_initiated_by = EXCLUDED.last_initiated_by,
    last_used_at = now(),
    child_frequency = conversation_topics.child_frequency + (CASE WHEN p_initiated_by = 'child' THEN 1 ELSE 0 END),
    k_frequency = conversation_topics.k_frequency + (CASE WHEN p_initiated_by = 'k' THEN 1 ELSE 0 END),
    parent_question_frequency = conversation_topics.parent_question_frequency + (CASE WHEN p_initiated_by = 'parent_question' THEN 1 ELSE 0 END),
    cooldown_until = now() + (p_cooldown_days || ' days')::interval,
    updated_at = now();
END;
$$;

-- codex-rv 지적(2차 리뷰): SECURITY DEFINER + anon/authenticated 실행권한은 RLS의
-- service_only 정책을 완전히 우회해 임의 child_id로 다른 아이 데이터를 조작할 수 있는
-- 구멍이었다. 이 RPC는 항상 서버(createServiceClient)에서만 호출하므로 기존
-- search_memory_facts와 동일하게 service_role에만 허용한다.
REVOKE EXECUTE ON FUNCTION record_conversation_topic_usage(UUID, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_conversation_topic_usage(UUID, TEXT, TEXT, TEXT, INT) TO service_role;
