-- chat_sessions에 A~E(F 포함) 테스트 모드 컬럼 추가 — 모드별 활성 세션을 독립적으로
-- 조회/종료하기 위함(기존엔 child_id만으로 활성 세션을 찾아 A/B/C/D/E가 하나의
-- 미션 세션을 공유하는 버그가 있었음). 기존 행은 NULL로 남는다(비파괴적).
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS test_mode TEXT
  CHECK (test_mode IS NULL OR test_mode IN ('A', 'B', 'C', 'D', 'E', 'F'));

CREATE INDEX IF NOT EXISTS idx_chat_sessions_child_test_mode
  ON chat_sessions(child_id, test_mode)
  WHERE demo_mode = true;

GRANT ALL ON chat_sessions TO anon, authenticated;
