-- REQUEST 093: 기존 가족에 role='parent'로 합류한 신규 보호자는 별도 아이 등록 없이
-- 회원가입을 완료한다. 가족 생성자인 owner_parent는 기존 4/4 아이 등록 흐름을 유지한다.

CREATE OR REPLACE FUNCTION public.complete_joined_parent_onboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'parent' AND NEW.deleted_at IS NULL THEN
    UPDATE public.parents
    SET account_status = 'ACTIVE',
        onboarding_completed_at = COALESCE(onboarding_completed_at, now())
    WHERE id = NEW.user_id
      AND account_status IN ('AUTHENTICATED_INCOMPLETE', 'ONBOARDING');

    UPDATE public.signup_consents
    SET family_id = NEW.family_id
    WHERE user_id = NEW.user_id
      AND family_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_joined_parent_onboarding() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_complete_joined_parent_onboarding ON public.family_members;
CREATE TRIGGER trg_complete_joined_parent_onboarding
AFTER INSERT OR UPDATE OF role, deleted_at ON public.family_members
FOR EACH ROW
EXECUTE FUNCTION public.complete_joined_parent_onboarding();

-- 이미 정상 parent 멤버십으로 연결됐지만 온보딩 상태가 남아 있는 행도 동일 규칙으로 보정한다.
UPDATE public.parents AS p
SET account_status = 'ACTIVE',
    onboarding_completed_at = COALESCE(p.onboarding_completed_at, now())
FROM public.family_members AS fm
WHERE fm.user_id = p.id
  AND fm.role = 'parent'
  AND fm.deleted_at IS NULL
  AND p.account_status IN ('AUTHENTICATED_INCOMPLETE', 'ONBOARDING');

UPDATE public.signup_consents AS sc
SET family_id = fm.family_id
FROM public.family_members AS fm
WHERE fm.user_id = sc.user_id
  AND fm.role = 'parent'
  AND fm.deleted_at IS NULL
  AND sc.family_id IS NULL;
