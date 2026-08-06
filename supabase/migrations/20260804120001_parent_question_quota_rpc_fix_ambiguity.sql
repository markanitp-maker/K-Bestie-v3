-- requests/request-parent-question-feature.md
-- 20260804120000의 try_deduct_parent_question_quota가 RETURNS TABLE의 OUT 파라미터명
-- (weekly_used_count/weekly_reset_at)이 parent_question_quota 테이블의 실제 컬럼명과
-- 동일해 PL/pgSQL이 "column reference is ambiguous"로 즉시 실패하던 버그를 수정한다
-- (Dev 실제 호출로 재현·확인 완료). 테이블 참조에 별칭(q)을 붙여 명확히 구분한다.

CREATE OR REPLACE FUNCTION public.try_deduct_parent_question_quota(p_child_id uuid)
RETURNS TABLE(allowed boolean, weekly_used_count integer, weekly_reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_week_start timestamptz := (date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul');
  v_used integer;
  v_reset timestamptz;
BEGIN
  INSERT INTO public.parent_question_quota (child_id, weekly_used_count, weekly_reset_at)
  VALUES (p_child_id, 0, v_week_start)
  ON CONFLICT (child_id) DO NOTHING;

  SELECT q.weekly_used_count, q.weekly_reset_at INTO v_used, v_reset
  FROM public.parent_question_quota q
  WHERE q.child_id = p_child_id
  FOR UPDATE;

  IF v_reset < v_week_start THEN
    v_used := 0;
    v_reset := v_week_start;
    UPDATE public.parent_question_quota q
    SET weekly_used_count = 0, weekly_reset_at = v_week_start
    WHERE q.child_id = p_child_id;
  END IF;

  IF v_used >= 3 THEN
    RETURN QUERY SELECT false, v_used, v_reset;
    RETURN;
  END IF;

  UPDATE public.parent_question_quota q
  SET weekly_used_count = q.weekly_used_count + 1
  WHERE q.child_id = p_child_id
  RETURNING q.weekly_used_count, q.weekly_reset_at INTO v_used, v_reset;

  RETURN QUERY SELECT true, v_used, v_reset;
END;
$$;

REVOKE ALL ON FUNCTION public.try_deduct_parent_question_quota(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_deduct_parent_question_quota(uuid) TO service_role;
