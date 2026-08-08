DROP TRIGGER IF EXISTS trg_complete_joined_parent_onboarding ON public.family_members;
DROP FUNCTION IF EXISTS public.complete_joined_parent_onboarding();

-- 이미 완료로 전환된 보호자 상태와 signup_consents.family_id는 감사 가능한 실제 합류
-- 결과이므로 롤백 시 임의로 되돌리지 않는다.
