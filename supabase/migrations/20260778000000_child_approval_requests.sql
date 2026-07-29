-- requests/053-family-onboarding-child-approval-pwa-install.md — 아이별 개별 승인 체계.
-- 미승인 아이는 실제 로그인 계정도 child_profiles도 만들지 않는다. 아이 추가 폼 데이터
-- (로그인 아이디·비밀번호 포함)는 관리자가 승인하는 순간에만 실제 계정·프로필로 전환된다.
-- Dev 전용 적용 — Production은 이 마이그레이션을 이번 세션에서 절대 적용하지 않는다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 이미 생성된 테이블이 있으면(재적용) NOT NULL 제약을 완화한다 - 승인/거절 완료 시
-- encrypted_password를 NULL로 비우는데(노출 최소화) 이 제약과 충돌하면 그 UPDATE 자체가
-- 실패한다.
ALTER TABLE IF EXISTS public.child_approval_requests ALTER COLUMN encrypted_password DROP NOT NULL;

-- child_profiles: 요청 필드에 성별이 포함되어 있으나 기존 코드베이스 어디에도 gender 컬럼이
-- 없었다. nullable로 1개만 추가 — 기존 행은 전부 NULL로 남고 그 외 기존 데이터는 무변경.
ALTER TABLE public.child_profiles
  ADD COLUMN IF NOT EXISTS gender TEXT;

-- ================================================================
-- child_approval_requests
-- ================================================================
CREATE TABLE IF NOT EXISTS public.child_approval_requests (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id                 UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  requested_by              UUID NOT NULL REFERENCES auth.users(id),
  family_creator_id         UUID NOT NULL REFERENCES auth.users(id),
  requester_email           TEXT NOT NULL,
  family_creator_email      TEXT NOT NULL,

  -- 아이 추가 폼 스냅샷 (요청하신 항목만: 성/이름/성별/아이디/비밀번호/학년/관심사/법정대리인 동의)
  family_name               TEXT NOT NULL,
  given_name                TEXT NOT NULL,
  gender                    TEXT,
  username                  TEXT NOT NULL,
  encrypted_password        BYTEA, -- 승인/거절 완료 시 NULL로 비워 평문 노출 최소화(생성 시점엔 NOT NULL 상당으로 항상 채워짐)
  grade                     TEXT NOT NULL,
  interests                 TEXT[] NOT NULL DEFAULT '{}',
  guardian_consent          BOOLEAN NOT NULL,
  guardian_consent_version  TEXT NOT NULL,

  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'rejected', 'creation_failed')),

  -- 재시도 안전장치: 계정/프로필이 이미 생성됐는지 여기서 먼저 확인해 중복 생성을 막는다.
  created_auth_user_id      UUID,
  created_child_id          UUID REFERENCES public.child_profiles(id),

  -- 동시 승인 처리 클레임(중복 클릭/동시 요청 방지). 2분 이상 지난 클레임은 죽은 것으로 간주하고
  -- 재시도가 다시 가져갈 수 있다 - Node 오케스트레이션 도중 크래시돼도 영구 락이 걸리지 않는다.
  processing_started_at     TIMESTAMPTZ,

  requested_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at               TIMESTAMPTZ,
  reviewed_by               UUID,
  rejected_reason           TEXT,
  failure_reason            TEXT,
  failed_at                 TIMESTAMPTZ,
  beta_verified             BOOLEAN NOT NULL DEFAULT false,
  survey_verified           BOOLEAN NOT NULL DEFAULT false,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 같은 아이디로 pending/creation_failed 요청이 동시에 여러 개 존재할 수 없다(전역 유일성은
-- member_accounts.username_unique와 별개로, 승인 전 요청 단계에서도 선점 충돌을 막는다).
CREATE UNIQUE INDEX IF NOT EXISTS idx_child_approval_requests_username_active
  ON public.child_approval_requests (username)
  WHERE status IN ('pending', 'creation_failed');

CREATE INDEX IF NOT EXISTS idx_child_approval_requests_family ON public.child_approval_requests (family_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_child_approval_requests_status ON public.child_approval_requests (status, requested_at DESC);

ALTER TABLE public.child_approval_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.child_approval_requests TO anon, authenticated;

-- 이 테이블은 admin_audit_log/plan_change_requests와 동일하게 service_role 경유
-- (서버 API + requireAdmin/오너 검증 완료 후) 전용으로만 쓴다 - anon/authenticated 직접 접근 차단.
DROP POLICY IF EXISTS "child_approval_requests_service_all" ON public.child_approval_requests;
CREATE POLICY "child_approval_requests_service_all"
  ON public.child_approval_requests FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 감사로그 액션 확장
ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN (
    'view_conversations',
    'view_safety_events',
    'view_safety_event_text',
    'account_withdrawal_requested',
    'account_restore_requested',
    'account_restore_approved',
    'account_restore_rejected',
    'account_purged',
    'beta_application_approved',
    'beta_application_rejected',
    'plan_change_request_approved',
    'plan_change_request_rejected',
    'child_approval_request_approved',
    'child_approval_request_creation_failed',
    'child_approval_request_rejected'
  ));

-- ================================================================
-- 1) 부모 화면에서 아이 추가 폼 제출 -> 승인 요청 생성 (즉시 계정 생성 없음)
-- ================================================================
CREATE OR REPLACE FUNCTION public.create_child_approval_request(
  p_family_id UUID,
  p_requested_by UUID,
  p_family_creator_id UUID,
  p_requester_email TEXT,
  p_family_creator_email TEXT,
  p_family_name TEXT,
  p_given_name TEXT,
  p_gender TEXT,
  p_username TEXT,
  p_password TEXT,
  p_encryption_key TEXT,
  p_grade TEXT,
  p_interests TEXT[],
  p_guardian_consent BOOLEAN,
  p_guardian_consent_version TEXT
)
RETURNS TABLE(success BOOLEAN, reason TEXT, request_id UUID)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_request_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('child_approval_request_username_' || p_username));

  IF NOT p_guardian_consent THEN
    RETURN QUERY SELECT false, 'guardian_consent_required'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.member_accounts WHERE username = p_username) THEN
    RETURN QUERY SELECT false, 'username_taken'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.child_approval_requests
    WHERE username = p_username AND status IN ('pending', 'creation_failed')
  ) THEN
    RETURN QUERY SELECT false, 'username_taken'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.child_approval_requests (
    family_id, requested_by, family_creator_id, requester_email, family_creator_email,
    family_name, given_name, gender, username, encrypted_password,
    grade, interests, guardian_consent, guardian_consent_version
  ) VALUES (
    p_family_id, p_requested_by, p_family_creator_id, p_requester_email, p_family_creator_email,
    p_family_name, p_given_name, p_gender, p_username, pgp_sym_encrypt(p_password, p_encryption_key),
    p_grade, p_interests, p_guardian_consent, p_guardian_consent_version
  )
  RETURNING id INTO v_request_id;

  RETURN QUERY SELECT true, NULL::TEXT, v_request_id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_child_approval_request(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_child_approval_request(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], BOOLEAN, TEXT
) TO service_role;

-- ================================================================
-- 2) 관리자 승인 처리 시작 - 클레임 + 스냅샷 반환 (Node가 이후 auth.admin.createUser 등을 수행)
-- ================================================================
DROP FUNCTION IF EXISTS public.admin_claim_child_approval_request(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.admin_claim_child_approval_request(
  p_request_id UUID,
  p_encryption_key TEXT
)
RETURNS TABLE(
  success BOOLEAN, reason TEXT,
  family_id UUID, family_name TEXT, given_name TEXT, gender TEXT,
  username TEXT, decrypted_password TEXT, grade TEXT, interests TEXT[],
  guardian_consent BOOLEAN, guardian_consent_version TEXT,
  guardian_consent_requested_at TIMESTAMPTZ,
  created_auth_user_id UUID, created_child_id UUID
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row public.child_approval_requests;
BEGIN
  UPDATE public.child_approval_requests
  SET processing_started_at = now()
  WHERE id = p_request_id
    AND status IN ('pending', 'creation_failed')
    AND (processing_started_at IS NULL OR processing_started_at < now() - INTERVAL '2 minutes')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_claimable'::TEXT,
      NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT[],
      NULL::BOOLEAN, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true, NULL::TEXT,
    v_row.family_id, v_row.family_name, v_row.given_name, v_row.gender,
    v_row.username,
    CASE WHEN v_row.created_auth_user_id IS NULL
      THEN pgp_sym_decrypt(v_row.encrypted_password, p_encryption_key)
      ELSE NULL END,
    v_row.grade, v_row.interests,
    v_row.guardian_consent, v_row.guardian_consent_version,
    v_row.requested_at,
    v_row.created_auth_user_id, v_row.created_child_id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.admin_claim_child_approval_request(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_child_approval_request(UUID, TEXT) TO service_role;

-- ================================================================
-- 3) auth 계정 생성 성공 직후 즉시 기록 (재시도 시 중복 계정 생성 방지)
-- ================================================================
CREATE OR REPLACE FUNCTION public.admin_record_child_approval_auth_created(
  p_request_id UUID,
  p_auth_user_id UUID
)
RETURNS TABLE(success BOOLEAN)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE public.child_approval_requests
  SET created_auth_user_id = p_auth_user_id, updated_at = now()
  WHERE id = p_request_id AND created_auth_user_id IS NULL;

  RETURN QUERY SELECT FOUND;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.admin_record_child_approval_auth_created(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_child_approval_auth_created(UUID, UUID) TO service_role;

-- ================================================================
-- 4) 승인 확정 (child_profiles 생성까지 Node에서 성공한 뒤 호출)
-- ================================================================
CREATE OR REPLACE FUNCTION public.admin_finalize_child_approval_success(
  p_request_id UUID,
  p_admin_user_id UUID,
  p_admin_email TEXT,
  p_child_id UUID
)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  UPDATE public.child_approval_requests
  SET status = 'approved',
      created_child_id = p_child_id,
      reviewed_at = now(),
      reviewed_by = p_admin_user_id,
      processing_started_at = NULL,
      encrypted_password = NULL,
      updated_at = now()
  WHERE id = p_request_id
  RETURNING family_id INTO v_family_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, child_id)
  VALUES (p_admin_user_id, p_admin_email, 'child_approval_request_approved', v_family_id, p_child_id);

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.admin_finalize_child_approval_success(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finalize_child_approval_success(UUID, UUID, TEXT, UUID) TO service_role;

-- ================================================================
-- 5) 프로필 생성 실패 - creation_failed 상태로 전환(재시도 가능하게 유지)
-- ================================================================
CREATE OR REPLACE FUNCTION public.admin_finalize_child_approval_failure(
  p_request_id UUID,
  p_admin_user_id UUID,
  p_admin_email TEXT,
  p_reason TEXT
)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  UPDATE public.child_approval_requests
  SET status = 'creation_failed',
      failure_reason = p_reason,
      failed_at = now(),
      processing_started_at = NULL,
      updated_at = now()
  WHERE id = p_request_id
  RETURNING family_id INTO v_family_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, reason)
  VALUES (p_admin_user_id, p_admin_email, 'child_approval_request_creation_failed', v_family_id, p_reason);

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.admin_finalize_child_approval_failure(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finalize_child_approval_failure(UUID, UUID, TEXT, TEXT) TO service_role;

-- ================================================================
-- 6) 거절 - 계정/프로필 생성 안 함. created_auth_user_id가 있으면(이전 실패 재시도 중이었다면)
--    Node가 이 함수 호출 전에 그 auth 계정을 정리(delete)하는 것을 전제로 한다 - 반환값으로
--    created_auth_user_id를 돌려줘 Node가 정리 대상을 알 수 있게 한다.
-- ================================================================
CREATE OR REPLACE FUNCTION public.admin_reject_child_approval_request(
  p_request_id UUID,
  p_admin_user_id UUID,
  p_admin_email TEXT,
  p_reason TEXT
)
RETURNS TABLE(success BOOLEAN, reason TEXT, orphaned_auth_user_id UUID)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_family_id UUID;
  v_auth_user_id UUID;
BEGIN
  UPDATE public.child_approval_requests
  SET status = 'rejected',
      rejected_reason = p_reason,
      reviewed_at = now(),
      reviewed_by = p_admin_user_id,
      processing_started_at = NULL,
      encrypted_password = NULL,
      updated_at = now()
  WHERE id = p_request_id
    AND status IN ('pending', 'creation_failed')
  RETURNING family_id, created_auth_user_id INTO v_family_id, v_auth_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found_or_already_processed'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, reason)
  VALUES (p_admin_user_id, p_admin_email, 'child_approval_request_rejected', v_family_id, p_reason);

  RETURN QUERY SELECT true, NULL::TEXT, v_auth_user_id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.admin_reject_child_approval_request(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_child_approval_request(UUID, UUID, TEXT, TEXT) TO service_role;
