-- 2026-08-11 Dev 마이그레이션 drift 복구: families.premium_retention_years 누락.
--
-- 근거: 20260811180000_plan_retention_hard_delete.sql을 Dev에 적용하던 중
-- "column premium_retention_years of relation families does not exist" 실측 에러로
-- 발견. 원 출처 20260725100000_plan_retention_extension.sql은 같은 파일 안에서
-- insight_retention_extensions 테이블(존재 확인됨)과 families.premium_retention_years
-- 컬럼(부재 확인됨)을 함께 추가하는데, Dev에는 테이블만 있고 컬럼은 없는 상태였다 —
-- 이 세션의 다른 Dev drift 사고(chat_messages_mode_check 등)와 동일 계열이다.
-- Production은 이 대상이 아니다(별도 확인 없이 이 파일을 Production에 적용하지 않는다).

ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS premium_retention_years integer NOT NULL DEFAULT 5
  CHECK (premium_retention_years IN (1, 3, 5));
