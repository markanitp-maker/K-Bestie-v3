-- 2026-08-11 게이트①(Codex Sol) 지적 수정: admin_check_child_auth_orphan이
-- child_profiles.member_id를 Auth UUID로 잘못 대조하고 있었다.
--
-- child_profiles.member_id는 family_members.id를 참조하지, auth.users.id(Auth 계정 id)를
-- 직접 참조하지 않는다. 즉 원래 조건 `child_profiles.member_id = v_id`는 스키마상 절대
-- 참이 될 수 없는 비교이거나(대개 무해한 no-op), family_members.id와 auth.users.id UUID가
-- 우연히 같은 값을 가지는 극히 드문 경우 실제로는 연결된 계정을 "고아"로 오판할 수 있는
-- 잘못된 판정 조건이었다. 이미 EXISTS (family_members WHERE user_id = v_id)로 동일한
-- "이 Auth 계정이 어느 가족에 연결돼 있는가"를 정확히 검사하고 있으므로, 그 결과와 항상
-- 겹치는 이 중복·오류 조건은 제거한다.
CREATE OR REPLACE FUNCTION public.admin_check_child_auth_orphan(p_email TEXT)
RETURNS TABLE(auth_user_id UUID, is_orphan BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM auth.users WHERE email = p_email;
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_id,
    NOT (
      EXISTS (SELECT 1 FROM public.member_accounts WHERE id = v_id)
      OR EXISTS (SELECT 1 FROM public.family_members WHERE user_id = v_id)
      OR EXISTS (SELECT 1 FROM public.child_approval_requests WHERE created_auth_user_id = v_id)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_check_child_auth_orphan(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_check_child_auth_orphan(TEXT) TO service_role;
