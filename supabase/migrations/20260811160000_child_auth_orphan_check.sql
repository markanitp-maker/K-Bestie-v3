-- 2026-08-11 Production 인시던트 대응: 아이 로그인 아이디 중복 오류 처리 개선.
--
-- 배경: auth.admin.createUser() 성공 후 family_members/member_accounts/child_profiles/
-- finalize/부모 ACTIVE 전환 중 한 단계라도 실패하면 그 실패 분기들이 DB 쪽 행만 되돌리고
-- Auth 계정 자체는 삭제하지 않아 auth.users에 아무 데이터에도 연결되지 않은 고아 계정이
-- 남았다(실제로 hks@kbestie.local에서 재현·확인). 이 고아 계정이 남아있는 한 같은
-- 아이디로는 영원히 재등록할 수 없고, 사용자에게는 Supabase 원문 에러가 그대로 노출됐다.
--
-- 이 함수는 애플리케이션 코드(lib/plan/createChildAuthAccount.ts)가 auth.admin.createUser
-- 중복 오류를 만났을 때, 충돌 중인 내부 이메일이 실제 사용 중인 계정인지 고아 계정인지
-- 판정하기 위해 호출한다. member_accounts/family_members/child_profiles/
-- child_approval_requests 어디에도 연결되지 않았으면(그리고 이 4개 테이블이 곧 "실사용"의
-- 전체 판정 기준이다) 고아로 간주해 안전하게 삭제 후 재시도할 수 있게 한다.
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
    RETURN; -- 해당 이메일의 Auth 계정 자체가 없음 — 호출부는 이 경우 재시도 자체가 무의미하다고 판단해야 한다
  END IF;

  RETURN QUERY
  SELECT
    v_id,
    NOT (
      EXISTS (SELECT 1 FROM public.member_accounts WHERE id = v_id)
      OR EXISTS (SELECT 1 FROM public.family_members WHERE user_id = v_id)
      OR EXISTS (SELECT 1 FROM public.child_profiles WHERE member_id = v_id)
      OR EXISTS (SELECT 1 FROM public.child_approval_requests WHERE created_auth_user_id = v_id)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_check_child_auth_orphan(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_check_child_auth_orphan(TEXT) TO service_role;
