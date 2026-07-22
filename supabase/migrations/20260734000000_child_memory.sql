-- Plan02 §8 기억(Memory) 기능 — 단기(7일)/장기 기억 저장.
-- 원문(chat_messages)은 그대로 두고, 배치가 요약해 이 테이블에 별도 저장한다(원문 삭제와 무관).
-- 하루 2회 배치(18:00, 23:59:59 KST)가 채움. RPC/API가 아직 실시간 대화 프롬프트에 주입하지는
-- 않는다(§8 "필요 시 검색"은 이번 범위에서 저장+조회 API까지만, 실시간 통합은 후속).

CREATE TABLE IF NOT EXISTS child_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('short_term', 'long_term')),
  -- long_term 전용 세부 분류(관심사/친구/가족/꿈/사건). short_term은 NULL(그날의 일반 요약).
  category TEXT CHECK (category IS NULL OR category IN ('interest', 'friend', 'family', 'dream', 'event')),
  content TEXT NOT NULL,
  source_session_ids UUID[] NOT NULL DEFAULT '{}',
  business_date DATE NOT NULL, -- 이 기억이 다루는 KST 날짜(배치 idempotency 기준)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- short_term은 7일 뒤 만료(별도 정리 배치나 조회 시 필터링에 사용), long_term은 NULL(만료 없음).
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_child_memory_child_id ON child_memory(child_id);
CREATE INDEX IF NOT EXISTS idx_child_memory_child_type ON child_memory(child_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_child_memory_business_date ON child_memory(business_date);
-- 같은 아이·같은 날짜·같은 타입 배치를 두 번 돌려도 중복 생성되지 않도록.
CREATE UNIQUE INDEX IF NOT EXISTS uq_child_memory_batch_dedup
  ON child_memory(child_id, memory_type, business_date, COALESCE(category, ''));

ALTER TABLE child_memory ENABLE ROW LEVEL SECURITY;

-- 서비스 롤(배치·서버 API)만 전체 접근. 클라이언트(anon/authenticated)는 하드룰(§5 체크리스트)에
--따라 GRANT는 받되, 실제 행 접근은 RLS로 서비스 롤 전용으로 막아 부모/아이 세션이 직접 다른
-- 아이의 기억을 읽지 못하게 한다(이번 범위에서 클라이언트가 직접 이 테이블을 조회하는 화면은 없음).
CREATE POLICY "child_memory_service_all"
  ON child_memory FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON child_memory TO anon, authenticated;
