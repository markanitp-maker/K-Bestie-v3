-- 073 Phase 4 Dev 전용 검증. 모든 fixture/결과는 마지막 ROLLBACK으로 제거한다.
-- claude-review-073-phase4 게이트①의 R5(동시성 테스트가 DB를 전혀 건드리지 않음)
-- 지적에 대응해 award_mission_v3_reward/finalize_mission_turn_v1을 실제로 실행한다.
BEGIN;

DO $$
DECLARE
  v_family_id uuid;
  v_child_id uuid;
  v_session_id uuid;
  v_child_message_id uuid;
  v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_day_at timestamptz;
  v_count integer;
  v_reward record;
  v_finalize record;
BEGIN
  v_day_at := (v_day::text || ' 09:00:00+09')::timestamptz;

  INSERT INTO public.families(name, created_by)
  VALUES ('ROLLBACK-073P4-QA', (SELECT id FROM auth.users LIMIT 1))
  RETURNING id INTO v_family_id;

  INSERT INTO public.child_profiles(family_id, name, grade)
  VALUES (v_family_id, 'ROLLBACK-073P4-CHILD', '초3')
  RETURNING id INTO v_child_id;

  -- ── Fixture 1: 정상 완료(Goal 3/4) v3_single_daily 세션, business_date=v_day ──
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at, v_day)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at, status,
    required_valid_count, valid_answer_count
  ) VALUES (
    v_session_id, v_child_id, v_day::text, 'daily_single',
    'v3_single_daily', v_day_at - interval '1 hour', 'COMPLETED',
    1, 1
  );

  INSERT INTO public.conversation_goals(
    mission_session_id, child_id, goal_order, semantic_group, priority, status,
    evidence_source, confidence, satisfied_at
  )
  SELECT v_session_id, v_child_id, ord, 'GROUP_' || ord, 'P2',
    CASE WHEN ord <= 3 THEN 'SATISFIED' ELSE 'PENDING' END,
    CASE WHEN ord <= 3 THEN 'child_utterance' ELSE NULL END,
    CASE WHEN ord <= 3 THEN 0.9 ELSE NULL END,
    CASE WHEN ord <= 3 THEN v_day_at ELSE NULL END
  FROM generate_series(1, 4) AS ord;

  -- 1) 정상 지급: 정확히 1개 행, rewarded=true.
  SELECT * INTO v_reward FROM public.award_mission_v3_reward(
    v_child_id, v_day, 'mission_v3_complete', v_session_id
  );
  IF NOT v_reward.rewarded OR v_reward.reason <> 'rewarded' OR v_reward.satisfied_goal_count <> 3 THEN
    RAISE EXCEPTION 'expected first award to succeed: %', row_to_json(v_reward);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id AND reward_type = 'mission_v3_complete' AND business_date = v_day;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 ledger row after first award, got %', v_count;
  END IF;

  -- 2) 재시도/reopen: 같은 키로 20회 재호출해도 행은 여전히 1개, 전부 already_rewarded.
  FOR i IN 1..20 LOOP
    SELECT * INTO v_reward FROM public.award_mission_v3_reward(
      v_child_id, v_day, 'mission_v3_complete', v_session_id
    );
    IF v_reward.rewarded OR v_reward.reason <> 'already_rewarded' THEN
      RAISE EXCEPTION 'retry %/20 must be a no-op: %', i, row_to_json(v_reward);
    END IF;
  END LOOP;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id AND reward_type = 'mission_v3_complete' AND business_date = v_day;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'idempotency key must cap the ledger at 1 row, got %', v_count;
  END IF;

  -- 3) R3: source_session_id를 NULL로 SET(삭제 캐스케이드 시뮬레이션)해도
  --    gold_key_ledger_mission_v3_source_check가 막지 않는다.
  UPDATE public.gold_key_ledger
  SET source_session_id = NULL
  WHERE child_id = v_child_id AND reward_type = 'mission_v3_complete' AND business_date = v_day;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id AND reward_type = 'mission_v3_complete'
    AND business_date = v_day AND source_session_id IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'source_session_id SET NULL must not violate the mission_v3 CHECK: %', v_count;
  END IF;

  -- ── Fixture 2: Boredom 조기종료(Goal 2/4), 별도 business_date(v_day+1)로
  --    fixture 1의 유일 인덱스와 절대 겹치지 않게 한다 ─────────────────────
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at + interval '1 day', v_day + 1)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at, status,
    required_valid_count, valid_answer_count
  ) VALUES (
    v_session_id, v_child_id, (v_day + 1)::text, 'daily_single',
    'v3_single_daily', v_day_at - interval '1 hour', 'COMPLETED',
    1, 1
  );

  INSERT INTO public.conversation_goals(
    mission_session_id, child_id, goal_order, semantic_group, priority, status,
    evidence_source, confidence, satisfied_at
  )
  SELECT v_session_id, v_child_id, ord, 'BGROUP_' || ord, 'P2',
    CASE WHEN ord <= 2 THEN 'SATISFIED' ELSE 'PENDING' END,
    CASE WHEN ord <= 2 THEN 'child_utterance' ELSE NULL END,
    CASE WHEN ord <= 2 THEN 0.9 ELSE NULL END,
    CASE WHEN ord <= 2 THEN v_day_at + interval '1 day' ELSE NULL END
  FROM generate_series(1, 4) AS ord;

  SELECT * INTO v_reward FROM public.award_mission_v3_reward(
    v_child_id, v_day + 1, 'mission_v3_complete', v_session_id
  );
  IF v_reward.rewarded OR v_reward.reason <> 'goal_threshold_not_met' OR v_reward.satisfied_goal_count <> 2 THEN
    RAISE EXCEPTION 'boredom (Goal 2/4) must be rejected with goal_threshold_not_met: %', row_to_json(v_reward);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id AND reward_type = 'mission_v3_complete' AND business_date = v_day + 1;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'boredom rejection must not create any ledger row, got %', v_count;
  END IF;

  -- ── Fixture 3: R2 — 레거시 finalize_mission_turn_v1 경로가 v3 세션을
  --    자동완료·보상하지 않는지 직접 검증 (별도 business_date v_day+2) ─────
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at + interval '2 days', v_day + 2)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at, status,
    required_valid_count, valid_answer_count
  ) VALUES (
    v_session_id, v_child_id, (v_day + 2)::text, 'daily_single',
    'v3_single_daily', v_day_at - interval '1 hour', NULL,
    1, 1  -- valid_answer_count >= required_valid_count: 레거시 기준으로는 "완료"로 보인다
  );

  INSERT INTO public.chat_messages(session_id, turn_id, role, content, mode, voice_mode, display_sequence, turn_status)
  VALUES (v_session_id, 'r2-turn-1:child', 'child', '레거시 완료 판정 회귀 테스트', 'mission', 'stt_tts', 1, 'finalized')
  RETURNING id INTO v_child_message_id;

  INSERT INTO public.mission_turns(session_id, client_turn_id, question_id, status, child_message_id, answer_result)
  VALUES (v_session_id, 'r2-turn-1', 'q-r2-1', 'ANSWER_PROCESSED', v_child_message_id, '{"valid": true}'::jsonb);

  SELECT * INTO v_finalize FROM public.finalize_mission_turn_v1(
    v_session_id, 'r2-turn-1', '레거시 완료 판정 회귀 테스트에 대한 케이 응답', 'r2-turn-1:k', 2, false
  );

  IF v_finalize.completed THEN
    RAISE EXCEPTION 'R2 regression: finalize_mission_turn_v1 must never auto-complete a v3_single_daily session, got completed=true';
  END IF;
  IF v_finalize.reward_status <> 'none' THEN
    RAISE EXCEPTION 'R2 regression: finalize_mission_turn_v1 must not touch the legacy reward path for v3_single_daily, got %', v_finalize.reward_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mission_progress
    WHERE session_id = v_session_id AND status = 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'R2 regression: mission_progress.status must not be auto-set to COMPLETED for a v3_single_daily session via the legacy path';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.gold_key_ledger
    WHERE mission_id = v_session_id AND reward_type = 'mission_complete'
  ) THEN
    RAISE EXCEPTION 'R2 regression: legacy mission_complete reward must never be granted for a v3_single_daily session';
  END IF;

  RAISE NOTICE '073 Phase 4 reward idempotency verification: PASSED';
END;
$$;

ROLLBACK;
