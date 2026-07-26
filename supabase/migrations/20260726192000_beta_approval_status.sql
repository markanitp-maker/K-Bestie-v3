-- 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 SQL Editor에서 직접 실행할 것

ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

-- 기존 계정(마이그레이션 시점 이전 생성)은 일괄 'approved' 처리
-- (이로써 QA테스트/testi01/testi02/김서아/김서현 계정 등 모든 기존 테스트 계정이 자동으로 보호된다)
UPDATE public.parents
SET approval_status = 'approved',
    approved_at = now()
WHERE approval_status = 'pending';

-- 베타 신청 설문 저장용 테이블
CREATE TABLE IF NOT EXISTS public.beta_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.parents(id) ON DELETE CASCADE,
  answers      jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.beta_applications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.beta_applications TO anon, authenticated;

-- 정책: 본인 SELECT/INSERT + service_role ALL
CREATE POLICY "Users can insert their own beta applications"
  ON public.beta_applications
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own beta applications"
  ON public.beta_applications
  FOR SELECT
  USING (auth.uid() = user_id);

-- 감사 로그 액션 확장
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
    'beta_application_rejected'
  ));

-- 승인/거절 실행 RPC(원자적 처리 + 감사로그) — 20260724100000에서 admin_audit_log.child_id를
-- 이미 nullable로 풀어뒀고 target_user_id 컬럼도 이미 있으므로(계정복구 승인 패턴과 동일하게
-- 재사용), 베타 신청 승인/거절처럼 child_id가 자연스럽지 않은 액션도 그대로 기록 가능하다.
-- 대표님 확정 결정 반영: 승인 시 parents.tier만 갱신, child_profiles.tier는 건드리지 않는다.
CREATE OR REPLACE FUNCTION public.admin_approve_beta_application(
  p_admin_user_id UUID,
  p_admin_email TEXT,
  p_target_user_id UUID,
  p_tier INT
)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('beta_application_' || p_target_user_id::text));

  IF p_tier NOT IN (1, 2, 3) THEN
    RETURN QUERY SELECT false, 'invalid_tier'::TEXT;
    RETURN;
  END IF;

  SELECT approval_status INTO v_status FROM public.parents WHERE id = p_target_user_id;
  IF NOT FOUND OR v_status != 'pending' THEN
    RETURN QUERY SELECT false, 'invalid_state'::TEXT;
    RETURN;
  END IF;

  UPDATE public.parents
  SET approval_status = 'approved',
      approved_at = now(),
      approved_by = p_admin_user_id,
      rejected_reason = NULL,
      tier = p_tier
  WHERE id = p_target_user_id;

  UPDATE public.beta_applications
  SET reviewed_at = now(), reviewed_by = p_admin_user_id
  WHERE user_id = p_target_user_id AND reviewed_at IS NULL;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id)
  VALUES (p_admin_user_id, p_admin_email, 'beta_application_approved', p_target_user_id);

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.admin_reject_beta_application(
  p_admin_user_id UUID,
  p_admin_email TEXT,
  p_target_user_id UUID,
  p_reason TEXT
)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('beta_application_' || p_target_user_id::text));

  SELECT approval_status INTO v_status FROM public.parents WHERE id = p_target_user_id;
  IF NOT FOUND OR v_status != 'pending' THEN
    RETURN QUERY SELECT false, 'invalid_state'::TEXT;
    RETURN;
  END IF;

  UPDATE public.parents
  SET approval_status = 'rejected',
      rejected_reason = p_reason
  WHERE id = p_target_user_id;

  UPDATE public.beta_applications
  SET reviewed_at = now(), reviewed_by = p_admin_user_id
  WHERE user_id = p_target_user_id AND reviewed_at IS NULL;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, reason)
  VALUES (p_admin_user_id, p_admin_email, 'beta_application_rejected', p_target_user_id, p_reason);

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
