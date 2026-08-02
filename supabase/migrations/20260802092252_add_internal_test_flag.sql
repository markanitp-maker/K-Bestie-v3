-- 20260802092252_add_internal_test_flag.sql
-- 내부 테스트 계정 필터링을 위한 플래그 추가
-- (기존 is_test_account는 A/B 테스트/모드 오버라이드용이므로 리텐션 제외 플래그로 분리)

ALTER TABLE child_profiles
  ADD COLUMN IF NOT EXISTS is_internal_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE family_members
  ADD COLUMN IF NOT EXISTS is_internal_test BOOLEAN NOT NULL DEFAULT false;
