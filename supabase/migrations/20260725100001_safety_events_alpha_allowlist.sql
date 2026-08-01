-- =========================================================================
-- 목적: safety_events.child_text(아이 발화 원문) 열람을 알파 단계 한정 예외로 허용하는 접근 제어
-- 1. alpha_safety_text_allowlist 테이블 생성
-- 2. get_safety_event_child_text 보안 조회 함수 생성 (Fail-closed & 감사로그 포함)
-- 3. purge_safety_event_child_text_manually 수동 파기 함수 생성
-- 4. safety_events_admin_view 뷰 생성 (원문 제외)
-- =========================================================================

-- 1. 허용 리스트 테이블 생성
CREATE TABLE public.alpha_safety_text_allowlist (
  child_id UUID NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL,
  env TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, admin_user_id, env)
);

-- 요구사항 준수: 테이블 권한 부여 (실제 접근은 RLS로 제어)
GRANT ALL ON public.alpha_safety_text_allowlist TO anon, authenticated;

ALTER TABLE public.alpha_safety_text_allowlist ENABLE ROW LEVEL SECURITY;

-- service_role만 접근 가능하게 RLS 설정 (anon, authenticated는 기본 차단됨)
CREATE POLICY "alpha_safety_text_allowlist_service_all"
  ON public.alpha_safety_text_allowlist FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- 2. admin_audit_log 테이블 확장 (event_id 로깅 지원)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_audit_log' AND column_name='target_event_id') THEN
    ALTER TABLE public.admin_audit_log ADD COLUMN target_event_id UUID;
  END IF;
END $$;

-- 기존 action enum 체크 제약 조건 삭제 (새로운 action 값을 허용하기 위함)
ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;


-- 3. 안전 이벤트 원문 보안 조회 함수 (Fail-closed)
CREATE OR REPLACE FUNCTION public.get_safety_event_child_text(
  p_event_id UUID,
  p_requesting_admin_id UUID,
  p_env TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_child_id UUID;
  v_child_text TEXT;
  v_is_allowed BOOLEAN;
  v_admin_email TEXT;
BEGIN
  -- 1) 이벤트 및 관련 아동 ID 조회
  SELECT se.child_text, COALESCE(se.child_id, cs.child_id)
  INTO v_child_text, v_child_id
  FROM public.safety_events se
  LEFT JOIN public.chat_sessions cs ON cs.id = se.session_id
  WHERE se.id = p_event_id;

  -- Fail-closed: 이벤트가 존재하지 않거나, 원문이 파기되어 NULL인 경우 즉시 반환
  IF v_child_text IS NULL OR v_child_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2) 알파 환경 예외 허용 리스트 확인
  SELECT EXISTS (
    SELECT 1 FROM public.alpha_safety_text_allowlist
    WHERE child_id = v_child_id
      AND admin_user_id = p_requesting_admin_id
      AND env = p_env
  ) INTO v_is_allowed;

  -- Fail-closed: 허용 리스트에 없으면 무조건 NULL 반환
  IF NOT v_is_allowed THEN
    RETURN NULL;
  END IF;

  -- 3) 어드민 이메일 획득 (감사 로그용)
  SELECT email INTO v_admin_email
  FROM public.admin_roles
  WHERE id = p_requesting_admin_id;

  IF v_admin_email IS NULL THEN
    -- admin_roles에 없으면 auth.users에서라도 가져오기 시도, 실패시 fallback
    -- 보안 함수이므로, 이메일을 못 찾더라도 감사 로그는 남겨야 함.
    v_admin_email := 'unknown_admin_' || p_requesting_admin_id::text;
  END IF;

  -- 4) 감사 로그 기록
  INSERT INTO public.admin_audit_log (
    admin_user_id, 
    admin_email, 
    action, 
    child_id, 
    target_event_id
  ) VALUES (
    p_requesting_admin_id,
    v_admin_email,
    'view_safety_event_text',
    v_child_id,
    p_event_id
  );

  -- 모든 검증을 통과한 경우에만 원문 반환
  RETURN v_child_text;
END;
$$;

-- 보안 함수이므로 public 접근 제한
REVOKE EXECUTE ON FUNCTION public.get_safety_event_child_text FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_safety_event_child_text TO service_role;


-- 4. 수동 파기 함수 (168시간 경과)
CREATE OR REPLACE FUNCTION public.purge_safety_event_child_text_manually()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.safety_events
  SET child_text = NULL
  WHERE created_at < now() - interval '168 hours'
    AND child_text IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_safety_event_child_text_manually FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_safety_event_child_text_manually TO service_role;


-- 5. 관리자용 안전 이벤트 뷰 (원문 노출 원천 차단)
CREATE OR REPLACE VIEW public.safety_events_admin_view AS
SELECT 
  id,
  session_id,
  subcategory,
  created_at,
  viewed_at,
  -- 20260717150300_safety_events_extend.sql 에서 추가된 컬럼들 (에러 방지 차원에서 존재하는지 검증 없이 포함, 뷰 생성 시점엔 이미 존재)
  source,
  child_id,
  question_history_id,
  event_stage,
  policy_version
  -- child_text는 의도적으로 누락
FROM public.safety_events;

GRANT SELECT ON public.safety_events_admin_view TO service_role;
