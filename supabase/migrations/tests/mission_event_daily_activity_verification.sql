-- 089 Dev 전용 검증. 모든 fixture/결과는 마지막 ROLLBACK으로 제거한다.
BEGIN;

DO $$
DECLARE
  v_family_id uuid;
  v_child_id uuid;
  v_session_id uuid;
  v_day1 date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_day2 date := (now() AT TIME ZONE 'Asia/Seoul')::date + 1;
  v_day1_at timestamptz;
  v_day2_at timestamptz;
  v_count integer;
  v_reward record;
  v_constraint_columns text[];
BEGIN
  v_day1_at := (v_day1::text || ' 09:00:00+09')::timestamptz;
  v_day2_at := (v_day2::text || ' 09:00:00+09')::timestamptz;

  -- 신규 컬럼과 정확한 4-column UNIQUE 제약을 먼저 확인한다.
  SELECT count(*)::integer INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'child_mission_event_completions'
    AND column_name IN ('activity_type', 'business_date', 'source_session_id');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'event completion activity columns missing: %/3', v_count;
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ordinality) INTO v_constraint_columns
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conrelid = 'public.child_mission_event_completions'::regclass
    AND c.conname = 'child_mission_event_completions_daily_activity_unique'
    AND c.contype = 'u'
  GROUP BY c.oid;
  IF v_constraint_columns IS DISTINCT FROM ARRAY[
    'event_id', 'child_id', 'activity_type', 'business_date'
  ]::text[] THEN
    RAISE EXCEPTION 'daily activity UNIQUE columns mismatch: %', v_constraint_columns;
  END IF;

  INSERT INTO public.families(name, created_by)
  VALUES ('ROLLBACK-089-EVENT-QA', (SELECT id FROM auth.users LIMIT 1))
  RETURNING id INTO v_family_id;

  INSERT INTO public.child_profiles(family_id, name, grade)
  VALUES (v_family_id, 'ROLLBACK-089-CHILD', '초1')
  RETURNING id INTO v_child_id;

  -- 같은 KST 날짜에 서로 다른 미션 3개가 완료돼도 이벤트는 정확히 +1이다.
  FOR i IN 1..3 LOOP
    INSERT INTO public.chat_sessions(child_id, session_type, started_at)
    VALUES (v_child_id, 'mission', v_day1_at + (i || ' minutes')::interval)
    RETURNING id INTO v_session_id;

    PERFORM public.record_mission_event_completion(
      v_child_id,
      'development',
      'mission_complete',
      v_session_id,
      v_day1_at + (i || ' minutes')::interval
    );
  END LOOP;

  SELECT mission_completed_count INTO v_count
  FROM public.child_mission_onboarding_events
  WHERE child_id = v_child_id AND environment = 'development';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'same-day 3 missions expected event count 1, got %', v_count;
  END IF;

  -- 60초 미달: 의미 발화가 3개여도 Gold Key와 이벤트 모두 증가하지 않는다.
  INSERT INTO public.chat_sessions(child_id, session_type, started_at)
  VALUES (v_child_id, 'free_chat', v_day1_at + interval '1 hour')
  RETURNING id INTO v_session_id;
  INSERT INTO public.chat_messages(session_id, role, content) VALUES
    (v_session_id, 'child', '오늘 축구를 했어'),
    (v_session_id, 'child', '친구랑 골도 넣었어'),
    (v_session_id, 'child', '정말 신나는 하루였어');

  SELECT * INTO v_reward
  FROM public.complete_freechat_daily_engagement(
    v_child_id,
    'development',
    v_session_id,
    3,
    v_day1_at + interval '1 hour 30 seconds'
  );
  IF v_reward.rewarded OR v_reward.reason <> 'session_too_short' THEN
    RAISE EXCEPTION 'short freechat should not reward: %', row_to_json(v_reward);
  END IF;

  -- 60초 이상이어도 반복 발화 3개는 farming으로 거절한다.
  INSERT INTO public.chat_sessions(child_id, session_type, started_at)
  VALUES (v_child_id, 'free_chat', v_day1_at + interval '2 hours')
  RETURNING id INTO v_session_id;
  INSERT INTO public.chat_messages(session_id, role, content) VALUES
    (v_session_id, 'child', '축구했어'),
    (v_session_id, 'child', '축구했어'),
    (v_session_id, 'child', '축구했어');

  SELECT * INTO v_reward
  FROM public.complete_freechat_daily_engagement(
    v_child_id,
    'development',
    v_session_id,
    3,
    v_day1_at + interval '2 hours 2 minutes'
  );
  IF v_reward.rewarded OR v_reward.reason <> 'spam_or_repeated_utterances' THEN
    RAISE EXCEPTION 'repeated freechat should not reward: %', row_to_json(v_reward);
  END IF;

  SELECT mission_completed_count INTO v_count
  FROM public.child_mission_onboarding_events
  WHERE child_id = v_child_id AND environment = 'development';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ineligible freechat changed event count: %', v_count;
  END IF;
  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id AND reward_type = 'freechat_daily_engagement';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ineligible freechat created Gold Key: %', v_count;
  END IF;

  -- 첫 적격 자유대화는 한 RPC에서 Gold Key +1과 이벤트 +1을 함께 만든다.
  INSERT INTO public.chat_sessions(child_id, session_type, started_at)
  VALUES (v_child_id, 'free_chat', v_day1_at + interval '3 hours')
  RETURNING id INTO v_session_id;
  INSERT INTO public.chat_messages(session_id, role, content) VALUES
    (v_session_id, 'child', '오늘 미술 시간에 그림을 그렸어'),
    (v_session_id, 'child', '파란 바다를 제일 크게 그렸어'),
    (v_session_id, 'child', '친구가 멋지다고 칭찬해줬어');

  SELECT * INTO v_reward
  FROM public.complete_freechat_daily_engagement(
    v_child_id,
    'development',
    v_session_id,
    3,
    v_day1_at + interval '3 hours 2 minutes'
  );
  IF NOT v_reward.rewarded OR v_reward.event_count <> 2 THEN
    RAISE EXCEPTION 'eligible freechat did not atomically reward/count: %', row_to_json(v_reward);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id
    AND reward_type = 'freechat_daily_engagement'
    AND business_date = v_day1;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'day1 freechat Gold Key expected 1, got %', v_count;
  END IF;

  -- 같은 날 다른 적격 세션은 성공 응답이지만 추가 지급/집계하지 않는다.
  INSERT INTO public.chat_sessions(child_id, session_type, started_at)
  VALUES (v_child_id, 'free_chat', v_day1_at + interval '4 hours')
  RETURNING id INTO v_session_id;
  INSERT INTO public.chat_messages(session_id, role, content) VALUES
    (v_session_id, 'child', '저녁에는 가족과 산책할 거야'),
    (v_session_id, 'child', '공원에서 강아지도 보고 싶어'),
    (v_session_id, 'child', '돌아와서 책도 읽을 거야');

  SELECT * INTO v_reward
  FROM public.complete_freechat_daily_engagement(
    v_child_id,
    'development',
    v_session_id,
    3,
    v_day1_at + interval '4 hours 2 minutes'
  );
  IF v_reward.rewarded OR v_reward.reason <> 'already_rewarded_today' OR v_reward.event_count <> 2 THEN
    RAISE EXCEPTION 'same-day freechat idempotency failed: %', row_to_json(v_reward);
  END IF;

  -- 다음 KST 날짜에는 미션/자유대화가 각각 다시 한 번씩 증가한다.
  FOR i IN 1..3 LOOP
    INSERT INTO public.chat_sessions(child_id, session_type, started_at)
    VALUES (v_child_id, 'mission', v_day2_at + (i || ' minutes')::interval)
    RETURNING id INTO v_session_id;

    PERFORM public.record_mission_event_completion(
      v_child_id,
      'development',
      'mission_complete',
      v_session_id,
      v_day2_at + (i || ' minutes')::interval
    );
  END LOOP;

  INSERT INTO public.chat_sessions(child_id, session_type, started_at)
  VALUES (v_child_id, 'free_chat', v_day2_at + interval '1 hour')
  RETURNING id INTO v_session_id;
  INSERT INTO public.chat_messages(session_id, role, content) VALUES
    (v_session_id, 'child', '오늘은 과학 실험을 했어'),
    (v_session_id, 'child', '물이 얼음으로 변하는 걸 봤어'),
    (v_session_id, 'child', '다음에는 직접 실험해보고 싶어');

  SELECT * INTO v_reward
  FROM public.complete_freechat_daily_engagement(
    v_child_id,
    'development',
    v_session_id,
    3,
    v_day2_at + interval '1 hour 2 minutes'
  );
  IF NOT v_reward.rewarded OR v_reward.event_count <> 4 THEN
    RAISE EXCEPTION 'day2 freechat did not reward/count: %', row_to_json(v_reward);
  END IF;

  SELECT mission_completed_count INTO v_count
  FROM public.child_mission_onboarding_events
  WHERE child_id = v_child_id AND environment = 'development';
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'two-day total expected 4, got %', v_count;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.child_mission_event_completions
  WHERE child_id = v_child_id AND counted = true;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'counted activity ledger expected 4 rows, got %', v_count;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id AND reward_type = 'freechat_daily_engagement';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'two-day freechat Gold Keys expected 2, got %', v_count;
  END IF;

  -- 이벤트가 더 이상 집계할 수 없는 정상 상태에서도 Gold Key만 남는 부분 반영이 없다.
  UPDATE public.child_mission_onboarding_events
  SET status = 'completed', completed_at = v_day2_at + interval '2 hours'
  WHERE child_id = v_child_id AND environment = 'development';

  INSERT INTO public.chat_sessions(child_id, session_type, started_at)
  VALUES (v_child_id, 'free_chat', v_day2_at + interval '3 hours')
  RETURNING id INTO v_session_id;
  INSERT INTO public.chat_messages(session_id, role, content) VALUES
    (v_session_id, 'child', '내일은 운동장에서 달리기를 할 거야'),
    (v_session_id, 'child', '친구와 이어달리기도 해보고 싶어'),
    (v_session_id, 'child', '끝나면 시원한 물을 마실 거야');

  -- day2에는 이미 보상됐으므로 다른 날짜로 완료시각을 넘겨 event_not_counted를 검증한다.
  SELECT * INTO v_reward
  FROM public.complete_freechat_daily_engagement(
    v_child_id,
    'development',
    v_session_id,
    3,
    v_day2_at + interval '1 day 3 hours 2 minutes'
  );
  IF v_reward.rewarded OR v_reward.reason <> 'event_not_counted' THEN
    RAISE EXCEPTION 'inactive event must not leave Gold Key only: %', row_to_json(v_reward);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id AND reward_type = 'freechat_daily_engagement';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'event_not_counted left a partial Gold Key: %', v_count;
  END IF;

  RAISE NOTICE '089 mission event daily activity verification: PASSED';
END;
$$;

ROLLBACK;
