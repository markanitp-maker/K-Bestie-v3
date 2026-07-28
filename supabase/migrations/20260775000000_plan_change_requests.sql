-- requests/027-child-profile-edit-and-plan-approval.md — 요금제 변경은 부모가 선택한 즉시
-- 적용되지 않고 관리자 승인을 거쳐야 한다. admin_approve_beta_application(20260726192000)과
-- 동일한 패턴(advisory lock + 원자적 처리 + admin_audit_log 기록)을 재사용한다.

CREATE TABLE IF NOT EXISTS public.plan_change_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id          UUID NOT NULL REFERENCES public.parents(id) ON DELETE CASCADE,
  child_id                UUID NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  current_plan_snapshot   INTEGER NOT NULL CHECK (current_plan_snapshot IN (1, 2, 3)),
  requested_tier          INTEGER NOT NULL CHECK (requested_tier IN (1, 2, 3)),
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at             TIMESTAMPTZ,
  reviewed_by             UUID,
  review_note             TEXT,
  approved_plan_applied_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 자녀 한 명당 pending 요청은 동시에 하나만 (§11 중복 요청 방지, DB 레벨 최종 방어선)
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_change_requests_one_pending_per_child
  ON public.plan_change_requests (child_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_plan_change_requests_parent ON public.plan_change_requests (parent_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_change_requests_status ON public.plan_change_requests (status, requested_at DESC);

ALTER TABLE public.plan_change_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.plan_change_requests TO anon, authenticated;

-- 이 테이블은 admin_audit_log와 동일하게 service_role 경유(서버 API + requireChildAccess/
-- requireAdmin 인가 완료 후) 전용으로만 쓴다 — anon/authenticated 직접 접근은 차단.
CREATE POLICY "plan_change_requests_service_all"
  ON public.plan_change_requests FOR ALL
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
    'plan_change_request_rejected'
  ));

-- 요청 생성: 부모·자녀 관계 검증은 호출 측(API route, requireChildAccess)에서 이미 끝났다는
-- 전제 하에 parent_user_id/child_id를 그대로 받는다(다른 RPC들과 동일 패턴).
CREATE OR REPLACE FUNCTION public.create_plan_change_request(
  p_parent_user_id UUID,
  p_child_id UUID,
  p_requested_tier INT
)
RETURNS TABLE(success BOOLEAN, reason TEXT, request_id UUID)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_tier INT;
  v_existing_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('plan_change_request_' || p_child_id::text));

  IF p_requested_tier NOT IN (1, 2, 3) THEN
    RETURN QUERY SELECT false, 'invalid_tier'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT tier INTO v_current_tier FROM public.child_profiles WHERE id = p_child_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'child_not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_current_tier = p_requested_tier THEN
    RETURN QUERY SELECT false, 'same_tier'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT id INTO v_existing_id FROM public.plan_change_requests
  WHERE child_id = p_child_id AND status = 'pending';
  IF FOUND THEN
    RETURN QUERY SELECT false, 'pending_exists'::TEXT, v_existing_id;
    RETURN;
  END IF;

  INSERT INTO public.plan_change_requests (parent_user_id, child_id, current_plan_snapshot, requested_tier)
  VALUES (p_parent_user_id, p_child_id, v_current_tier, p_requested_tier)
  RETURNING id INTO v_existing_id;

  RETURN QUERY SELECT true, NULL::TEXT, v_existing_id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_plan_change_request(UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_plan_change_request(UUID, UUID, INT) TO service_role;

-- 부모가 본인 pending 요청 취소 (§13 "허용된 경우 취소")
CREATE OR REPLACE FUNCTION public.cancel_plan_change_request(
  p_child_id UUID
)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('plan_change_request_' || p_child_id::text));

  UPDATE public.plan_change_requests
  SET status = 'cancelled', updated_at = now()
  WHERE child_id = p_child_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_pending_request'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.cancel_plan_change_request(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_plan_change_request(UUID) TO service_role;

-- 관리자 승인 — §19/§20 요청 당시 스냅샷과 현재 실제 tier가 다르면(요청 이후 다른 경로로
-- 이미 변경됨) 자동 승인하지 않고 충돌로 처리한다.
CREATE OR REPLACE FUNCTION public.admin_approve_plan_change_request(
  p_admin_user_id UUID,
  p_admin_email TEXT,
  p_request_id UUID
)
RETURNS TABLE(success BOOLEAN, reason TEXT, child_id UUID, old_tier INT, new_tier INT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
  v_actual_tier INT;
BEGIN
  SELECT * INTO v_req FROM public.plan_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::TEXT, NULL::UUID, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('plan_change_request_' || v_req.child_id::text));

  -- 락 획득 후 재조회(동시 처리 방지)
  SELECT * INTO v_req FROM public.plan_change_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RETURN QUERY SELECT false, 'already_processed'::TEXT, v_req.child_id, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  SELECT tier INTO v_actual_tier FROM public.child_profiles WHERE id = v_req.child_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'child_not_found'::TEXT, v_req.child_id, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  IF v_actual_tier != v_req.current_plan_snapshot THEN
    RETURN QUERY SELECT false, 'tier_conflict'::TEXT, v_req.child_id, v_actual_tier, v_req.requested_tier;
    RETURN;
  END IF;

  UPDATE public.child_profiles SET tier = v_req.requested_tier WHERE id = v_req.child_id;

  UPDATE public.plan_change_requests
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = p_admin_user_id,
      approved_plan_applied_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, child_id)
  VALUES (p_admin_user_id, p_admin_email, 'plan_change_request_approved', v_req.parent_user_id, v_req.child_id);

  RETURN QUERY SELECT true, NULL::TEXT, v_req.child_id, v_actual_tier, v_req.requested_tier;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.admin_approve_plan_change_request(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_plan_change_request(UUID, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_reject_plan_change_request(
  p_admin_user_id UUID,
  p_admin_email TEXT,
  p_request_id UUID,
  p_reason TEXT
)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
BEGIN
  SELECT * INTO v_req FROM public.plan_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::TEXT;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('plan_change_request_' || v_req.child_id::text));

  SELECT * INTO v_req FROM public.plan_change_requests WHERE id = p_request_id;
  IF v_req.status != 'pending' THEN
    RETURN QUERY SELECT false, 'already_processed'::TEXT;
    RETURN;
  END IF;

  UPDATE public.plan_change_requests
  SET status = 'rejected',
      reviewed_at = now(),
      reviewed_by = p_admin_user_id,
      review_note = p_reason,
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, child_id, reason)
  VALUES (p_admin_user_id, p_admin_email, 'plan_change_request_rejected', v_req.parent_user_id, v_req.child_id, p_reason);

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.admin_reject_plan_change_request(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_plan_change_request(UUID, TEXT, UUID, TEXT) TO service_role;
