-- 테스트: safety_events 원문 열람 통제 검증 (fail-closed)
DO $$
DECLARE
  v_col_count INTEGER;
  v_dummy_event_id UUID := gen_random_uuid();
  v_dummy_admin_id UUID := gen_random_uuid();
  v_rpc_result TEXT;
BEGIN
  -- 1. safety_events_admin_view에 child_text 컬럼이 존재하지 않아야 함
  SELECT count(*)::INT INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'safety_events_admin_view'
    AND column_name = 'child_text';

  IF v_col_count > 0 THEN
    RAISE EXCEPTION 'safety_events_admin_view must NOT contain child_text column';
  END IF;

  -- 2. get_safety_event_child_text를 허용 리스트에 없는 임의의 조합으로 호출 시 NULL 반환 검증
  SELECT public.get_safety_event_child_text(
    v_dummy_event_id,
    v_dummy_admin_id,
    'alpha'
  ) INTO v_rpc_result;

  IF v_rpc_result IS NOT NULL THEN
    RAISE EXCEPTION 'get_safety_event_child_text MUST return NULL for unauthorized combinations';
  END IF;

  RAISE NOTICE 'Section (Fail-Closed Verification): PASSED';
END;
$$;
