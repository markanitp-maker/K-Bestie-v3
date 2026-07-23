-- Plan01 §3/§6: 테스트 계정 게이팅 + A~E 대화방식 테스트 세션 override.
-- (1) child_profiles.is_test_account: 이 아이가 A~E 테스트 특별 UI 대상인지. additive, 기존 아이는 모두 false 유지.
-- (2) test_mode_overrides: 테스트 계정이 선택한 A~E 모드를 '실제 tier를 바꾸지 않고' 저장하는 세션 override.
--     테스트 종료 시 행 삭제로 override 해제. usage_events.conversation_mode 배선의 소스.
-- 서버 전용(service_role) — 모든 접근은 is_test_account 재검증하는 API를 통해서만.

ALTER TABLE child_profiles
  ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS test_mode_overrides (
  child_id          UUID PRIMARY KEY REFERENCES child_profiles(id) ON DELETE CASCADE,
  conversation_mode TEXT NOT NULL CHECK (conversation_mode IN ('A', 'B', 'C', 'D', 'E')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 서버(service_role) 전용 — usage_events와 동일한 서버 전용 원장 패턴(anon/authenticated GRANT 미부여, 의도된 예외).
ALTER TABLE test_mode_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "test_mode_overrides_service_all"
  ON test_mode_overrides FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
