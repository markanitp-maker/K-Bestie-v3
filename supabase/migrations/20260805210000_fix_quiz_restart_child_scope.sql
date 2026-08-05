-- 정적 리뷰 지적사항 수정: begin_quiz_start_charge의 재시작 분기가 quiz_attempts를
-- user_id만으로 종료 처리해, 부모 계정 하나로 여러 자녀에 접근 가능한 구조상
-- 자녀 B의 "새로 시작하기"가 진행 중이던 자녀 A의 퀴즈마스터 세션까지 강제
-- 종료시켰다. child_id 스코프를 추가해 본인 세션만 종료하도록 수정한다.
CREATE OR REPLACE FUNCTION public.begin_quiz_start_charge(
  p_child_id UUID,
  p_user_id UUID,
  p_keys_needed INTEGER,
  p_is_restart BOOLEAN DEFAULT false,
  p_ttl_seconds INTEGER DEFAULT 60
) RETURNS TABLE (
  guard_id UUID,
  consumption_id UUID,
  reason TEXT
) AS $$
DECLARE
  v_play_type CONSTANT TEXT := 'quizmaster';
  v_open_id UUID;
  v_guard_id UUID;
  v_consume_success BOOLEAN;
  v_header_id UUID;
  v_consume_reason TEXT;
BEGIN
  IF p_keys_needed IS NULL OR p_keys_needed <= 0 THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'invalid_amount'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  UPDATE play_start_guards
  SET status = 'released'
  WHERE child_id = p_child_id
    AND play_type = v_play_type
    AND status = 'open'
    AND expires_at <= now();

  SELECT id INTO v_open_id
  FROM play_start_guards
  WHERE child_id = p_child_id
    AND play_type = v_play_type
    AND status = 'open'
  FOR UPDATE;

  IF v_open_id IS NOT NULL THEN
    RETURN QUERY SELECT v_open_id, NULL::UUID, 'already_starting'::text;
    RETURN;
  END IF;

  INSERT INTO play_start_guards (child_id, play_type, mode, status, expires_at)
  VALUES (
    p_child_id,
    v_play_type,
    CASE WHEN p_is_restart THEN 'restart' ELSE 'start' END,
    'open',
    now() + make_interval(secs => p_ttl_seconds)
  )
  RETURNING id INTO v_guard_id;

  SELECT cgk.success, cgk.header_id, cgk.reason
  INTO v_consume_success, v_header_id, v_consume_reason
  FROM public.consume_gold_keys(
    p_child_id,
    p_keys_needed,
    'quiz_start:' || v_guard_id::text,
    NULL::UUID
  ) cgk;

  IF NOT v_consume_success THEN
    UPDATE play_start_guards SET status = 'released' WHERE id = v_guard_id;
    RETURN QUERY SELECT v_guard_id, NULL::UUID, COALESCE(v_consume_reason, 'consume_failed')::text;
    RETURN;
  END IF;

  -- 수정: user_id만으로 종료하면 같은 부모 계정의 다른 자녀 세션까지 종료된다.
  -- child_id를 반드시 함께 검사해 본인 세션만 종료한다.
  IF p_is_restart THEN
    UPDATE quiz_attempts
    SET status = 'expired'
    WHERE user_id = p_user_id
      AND child_id = p_child_id::text
      AND status IN ('in_progress', 'background');
  END IF;

  UPDATE play_start_guards
  SET consumption_id = v_header_id
  WHERE id = v_guard_id;

  RETURN QUERY SELECT v_guard_id, v_header_id, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
