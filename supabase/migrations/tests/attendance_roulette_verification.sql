-- Dev 검증 전용. 모든 fixture와 결과는 마지막 ROLLBACK으로 제거한다.
BEGIN;

DO $$
DECLARE
  v_family_id uuid;
  v_child_id uuid;
  v_actor_id uuid;
  v_actor_email text;
  v_code text;
  v_expected integer;
  v_result jsonb;
  v_replay jsonb;
  v_override_id uuid;
  v_count integer;
  v_cancelled boolean;
BEGIN
  SELECT id, COALESCE(email, 'rollback-admin@kbestie.local')
  INTO v_actor_id, v_actor_email
  FROM auth.users
  ORDER BY created_at
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'QA prerequisite failed: no existing auth actor';
  END IF;

  INSERT INTO public.families(name)
  VALUES ('ROLLBACK-ATTENDANCE-ROULETTE-QA')
  RETURNING id INTO v_family_id;

  -- 7개 결과 코드와 황금열쇠 단위-row 지급량, 기본 1회 제한을 전부 검증한다.
  FOREACH v_code IN ARRAY ARRAY['LOSE', 'KEY_1', 'KEY_3', 'KEY_5', 'KEY_7', 'KEY_9']
  LOOP
    v_expected := CASE v_code
      WHEN 'KEY_1' THEN 1 WHEN 'KEY_3' THEN 3 WHEN 'KEY_5' THEN 5
      WHEN 'KEY_7' THEN 7 WHEN 'KEY_9' THEN 9 ELSE 0 END;

    INSERT INTO public.child_profiles(family_id, name, grade, is_test_account, is_internal_test)
    VALUES (v_family_id, 'ROLLBACK-' || v_code, '초1', true, true)
    RETURNING id INTO v_child_id;

    SELECT public.spin_attendance_roulette(v_child_id, 'qa:' || v_code || ':' || gen_random_uuid(), v_code)
    INTO v_result;

    IF NOT COALESCE((v_result->>'ok')::boolean, false)
       OR v_result->>'resultCode' <> v_code
       OR (v_result->>'keyReward')::integer <> v_expected
       OR v_result->>'source' <> 'BASE' THEN
      RAISE EXCEPTION 'result settlement failed for %: %', v_code, v_result;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.gold_key_ledger
    WHERE attendance_roulette_spin_id = (v_result->>'spinId')::uuid;
    IF v_count <> v_expected THEN
      RAISE EXCEPTION 'ledger count mismatch for %: expected %, got %', v_code, v_expected, v_count;
    END IF;

    SELECT public.spin_attendance_roulette(v_child_id, 'qa:blocked:' || gen_random_uuid(), v_code)
    INTO v_replay;
    IF COALESCE((v_replay->>'ok')::boolean, true) OR v_replay->>'error' <> 'no_available_spin' THEN
      RAISE EXCEPTION 'daily base limit failed for %: %', v_code, v_replay;
    END IF;
  END LOOP;

  -- RETRY는 같은 KST 날짜에 정확히 한 번 추가 기회를 만들고 소비한다.
  INSERT INTO public.child_profiles(family_id, name, grade, is_test_account, is_internal_test)
  VALUES (v_family_id, 'ROLLBACK-RETRY', '초1', true, true)
  RETURNING id INTO v_child_id;

  SELECT public.spin_attendance_roulette(v_child_id, 'qa:retry-base:' || gen_random_uuid(), 'RETRY')
  INTO v_result;
  IF v_result->>'resultCode' <> 'RETRY' OR v_result->>'source' <> 'BASE'
     OR (v_result->>'retryCreditsRemaining')::integer <> 1
     OR NOT (v_result->>'canSpin')::boolean THEN
    RAISE EXCEPTION 'retry credit grant failed: %', v_result;
  END IF;

  SELECT public.spin_attendance_roulette(v_child_id, 'qa:retry-use:' || gen_random_uuid(), 'KEY_1')
  INTO v_replay;
  IF v_replay->>'resultCode' <> 'KEY_1' OR v_replay->>'source' <> 'RETRY'
     OR (v_replay->>'retryCreditsRemaining')::integer <> 0
     OR (v_replay->>'canSpin')::boolean THEN
    RAISE EXCEPTION 'retry credit consume failed: %', v_replay;
  END IF;

  SELECT public.spin_attendance_roulette(v_child_id, 'qa:retry-blocked:' || gen_random_uuid(), 'KEY_1')
  INTO v_replay;
  IF COALESCE((v_replay->>'ok')::boolean, true) OR v_replay->>'error' <> 'no_available_spin' THEN
    RAISE EXCEPTION 'retry reuse was not blocked: %', v_replay;
  END IF;

  -- 동일 idempotency key는 같은 spin/result를 반환하고 지급을 반복하지 않는다.
  INSERT INTO public.child_profiles(family_id, name, grade, is_test_account, is_internal_test)
  VALUES (v_family_id, 'ROLLBACK-IDEMPOTENCY', '초1', true, true)
  RETURNING id INTO v_child_id;
  SELECT public.spin_attendance_roulette(v_child_id, 'qa:idempotency:fixed', 'KEY_3') INTO v_result;
  SELECT public.spin_attendance_roulette(v_child_id, 'qa:idempotency:fixed', 'KEY_9') INTO v_replay;
  IF v_result->>'spinId' <> v_replay->>'spinId'
     OR v_replay->>'resultCode' <> 'KEY_3'
     OR NOT (v_replay->>'idempotent')::boolean THEN
    RAISE EXCEPTION 'idempotency replay failed: first %, replay %', v_result, v_replay;
  END IF;
  SELECT count(*) INTO v_count FROM public.gold_key_ledger
  WHERE attendance_roulette_spin_id = (v_result->>'spinId')::uuid;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'idempotency duplicated payout: % rows', v_count;
  END IF;

  -- one-shot은 날짜와 무관하게 pending을 유지하고 지급 성공 뒤에만 소진된다.
  INSERT INTO public.child_profiles(family_id, name, grade, is_test_account, is_internal_test)
  VALUES (v_family_id, 'ROLLBACK-OVERRIDE', '초1', true, true)
  RETURNING id INTO v_child_id;
  SELECT public.set_attendance_roulette_override(v_child_id, 'KEY_7', v_actor_id, v_actor_email, 'rollback QA')
  INTO v_override_id;
  UPDATE public.attendance_roulette_overrides SET created_at = now() - interval '3 days' WHERE id = v_override_id;
  SELECT public.spin_attendance_roulette(v_child_id, 'qa:override:' || gen_random_uuid(), 'LOSE') INTO v_result;
  IF v_result->>'resultCode' <> 'KEY_7' OR (v_result->>'keyReward')::integer <> 7 THEN
    RAISE EXCEPTION 'pending override did not win: %', v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.attendance_roulette_overrides
  WHERE id = v_override_id AND status = 'CONSUMED' AND consumed_spin_id = (v_result->>'spinId')::uuid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'override was not consumed atomically';
  END IF;
  SELECT public.cancel_attendance_roulette_override(v_child_id, v_actor_id, v_actor_email) INTO v_cancelled;
  IF v_cancelled THEN
    RAISE EXCEPTION 'consumed override was cancellable';
  END IF;

  -- pending 취소 뒤에는 강제 결과가 적용되지 않는다.
  INSERT INTO public.child_profiles(family_id, name, grade, is_test_account, is_internal_test)
  VALUES (v_family_id, 'ROLLBACK-CANCEL', '초1', true, true)
  RETURNING id INTO v_child_id;
  PERFORM public.set_attendance_roulette_override(v_child_id, 'KEY_9', v_actor_id, v_actor_email, 'rollback QA');
  SELECT public.cancel_attendance_roulette_override(v_child_id, v_actor_id, v_actor_email) INTO v_cancelled;
  IF NOT v_cancelled THEN RAISE EXCEPTION 'pending override cancel failed'; END IF;
  SELECT public.spin_attendance_roulette(v_child_id, 'qa:cancel:' || gen_random_uuid(), 'LOSE') INTO v_result;
  IF v_result->>'resultCode' <> 'LOSE' THEN
    RAISE EXCEPTION 'cancelled override still affected spin: %', v_result;
  END IF;

  -- 전날 미사용 retry는 오늘로 이월되지 않고 오늘 BASE가 우선한다.
  INSERT INTO public.child_profiles(family_id, name, grade, is_test_account, is_internal_test)
  VALUES (v_family_id, 'ROLLBACK-KST-DAY', '초1', true, true)
  RETURNING id INTO v_child_id;
  INSERT INTO public.attendance_roulette_days(child_id, attendance_date, base_spin_used, retry_credits_granted, retry_credits_used)
  VALUES (v_child_id, ((now() AT TIME ZONE 'Asia/Seoul')::date - 1), true, 1, 0);
  SELECT public.spin_attendance_roulette(v_child_id, 'qa:kst-new-day:' || gen_random_uuid(), 'KEY_1') INTO v_result;
  IF v_result->>'source' <> 'BASE'
     OR (v_result->>'attendanceDate')::date <> (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'KST logical day isolation failed: %', v_result;
  END IF;

  -- 자녀 법적 삭제 경로에서 신규 FK들이 삭제를 방해하지 않는다.
  DELETE FROM public.child_profiles WHERE id = v_child_id;
  SELECT count(*) INTO v_count FROM public.attendance_roulette_days WHERE child_id = v_child_id;
  IF v_count <> 0 THEN RAISE EXCEPTION 'child cascade cleanup failed'; END IF;

  -- 강제 결과 입력은 test/internal 계정이 아닌 경우 거부한다.
  INSERT INTO public.child_profiles(family_id, name, grade, is_test_account, is_internal_test)
  VALUES (v_family_id, 'ROLLBACK-NONTEST', '초1', false, false)
  RETURNING id INTO v_child_id;
  SELECT public.spin_attendance_roulette(v_child_id, 'qa:nontest:' || gen_random_uuid(), 'KEY_9') INTO v_result;
  IF COALESCE((v_result->>'ok')::boolean, true) OR v_result->>'error' <> 'test_result_not_allowed' THEN
    RAISE EXCEPTION 'production result injection guard failed: %', v_result;
  END IF;

  RAISE NOTICE 'attendance roulette Dev transaction QA PASS';
END;
$$;

ROLLBACK;
