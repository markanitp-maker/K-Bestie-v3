-- Plan01 §23 결정1: usage_events에 A~E 대화방식(conversation_mode) 태깅 컬럼 추가.
-- 신규 이벤트부터 mode(A~E)를 기록하고, 기존/미지정 행은 NULL(=미분류)로 남긴다.
-- 멱등: IF NOT EXISTS. 기존 데이터 영향 없음(모두 NULL로 귀결).
-- 보안(의도된 체크리스트 예외): usage_events는 비용/사용량 원장이라 서버(service_role) 전용 테이블이다.
--   기존 20260713100000_usage_events.sql이 service_role-only RLS(anon/authenticated 정책 없음)로 만든 테이블이며,
--   여기에 `GRANT ALL ... TO anon, authenticated`를 부여하면 모든 로그인 사용자에게 회사 원가/사용량이 노출되는
--   보안 회귀가 된다. 따라서 일반 GRANT 규칙을 의도적으로 적용하지 않고 service_role 전용을 그대로 유지한다.

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS conversation_mode TEXT
  CHECK (conversation_mode IS NULL OR conversation_mode IN ('A', 'B', 'C', 'D', 'E'));

CREATE INDEX IF NOT EXISTS idx_usage_events_mode ON usage_events(conversation_mode);

-- 기간·모드 복합 조회(관리자 대시보드 mode 필터) 최적화.
CREATE INDEX IF NOT EXISTS idx_usage_events_created_mode ON usage_events(created_at, conversation_mode);
