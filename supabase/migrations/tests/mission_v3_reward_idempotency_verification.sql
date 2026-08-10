-- 073 Phase 4 Dev 전용 검증. 모든 fixture/결과는 마지막 ROLLBACK으로 제거한다.
-- claude-review-073-phase4 게이트①의 R5 지적에 대응해 award_mission_v3_reward/
-- finalize_mission_turn_v1을 mock이 아닌 실제 DB에서 실행한다.
--
-- 2026-08-11 correction (claude-review-073-phase4-r2, F2/F3/F4):
--   F2: 2)의 20회 루프는 같은 트랜잭션 내 순차 재호출이다 — "동시" 재시도가
--       아니다. 실제 동시성 방어는 advisory lock + 유일 인덱스 설계에서
--       나오며(정적 리뷰로 확인됨), 이 스크립트는 그 설계 위에서 반복
--       재시도가 안전한지만 순차적으로 검증한다.
--   F3: effective_at을 v_day_at - interval '1 hour'(당일 08:00 KST 고정)로
--       두면 00:00~08:00 KST 사이 실행 시 created_at(now() 기본값) < effective_at
--       CHECK를 첫 INSERT에서 위반한다. now() - interval '1 minute'로 교체 —
--       실행 시각과 무관하게 항상 과거.
--   F4: fixture가 mission_progress.status를 'COMPLETED'로 직접 심어
--       award_mission_v3_reward가 그 값을 요구만 하는 것처럼 보이게
--       가렸다. F1 수정(RPC가 Goal 3/4+ 충족 시 스스로 COMPLETED로
--       전이)으로 status는 더 이상 fixture가 미리 심지 않고, RPC 호출 후
--       실제로 전이됐는지와 이벤트 완료 트리거가 발화했는지를 직접 확인한다.
BEGIN;

DO $$
DECLARE
  v_family_id uuid;
  v_child_id uuid;
  v_session_id uuid;
  v_child_message_id uuid;
  v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_day_at timestamptz;
  v_effective_at timestamptz := now() - interval '1 minute';
  v_count integer;
  v_status text;
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
  -- status는 심지 않는다(NULL) — award_mission_v3_reward 자신이 COMPLETED로
  -- 전이시키는지가 F1의 핵심 검증 대상이다.
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at, v_day)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at,
    required_valid_count, valid_answer_count
  ) VALUES (
    v_session_id, v_child_id, v_day::text, 'daily_single',
    'v3_single_daily', v_effective_at,
    1, 0
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

  -- trg_mission_progress_record_event_completion은 PostgREST의 request.headers
  -- Host로 environment(dev/prod)를 판별한다 — apply-migration.js는 Management API로
  -- 직접 SQL을 보내 이 컨텍스트가 없으므로, 실제 앱 요청을 트랜잭션-로컬로
  -- 흉내내 트리거의 하위 경로까지 실제로 검증한다.
  PERFORM set_config('request.headers', '{"host":"mkrsaaedxqrcrktapaus.supabase.co"}', true);

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

  -- F1 직접 검증: award_mission_v3_reward 스스로 mission_progress를 COMPLETED로
  -- 전이시켰는가 (finalize_mission_turn_v1 레거시 경로는 이 세션에 관여하지 않았다).
  SELECT status INTO v_status FROM public.mission_progress WHERE session_id = v_session_id;
  IF v_status IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'F1 regression: award_mission_v3_reward must transition mission_progress.status to COMPLETED itself, got %', v_status;
  END IF;

  -- F1 연쇄 검증: status 전이가 trg_mission_progress_event_completion을 통해
  -- 마스터 §17.4 "정상 완료 = 이벤트 활동 +1"을 실제로 기록했는가.
  SELECT count(*)::integer INTO v_count
  FROM public.child_mission_event_completions
  WHERE source_session_id = v_session_id AND activity_type = 'mission_complete';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'F1 regression: completion trigger must record exactly 1 mission_complete event row, got %', v_count;
  END IF;

  -- 2) 재시도/reopen: 같은 키로 20회 순차 재호출해도 행은 여전히 1개, 전부
  --    already_rewarded. (동시 호출이 아니라 순차 반복 검증 — 위 F2 참고.)
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
  --    fixture 1의 유일 인덱스와 절대 겹치지 않게 한다. status는 심지 않는다. ──
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at + interval '1 day', v_day + 1)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at,
    required_valid_count, valid_answer_count
  ) VALUES (
    v_session_id, v_child_id, (v_day + 1)::text, 'daily_single',
    'v3_single_daily', v_effective_at,
    1, 0
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

  -- Boredom 거부는 완료가 아니므로 status도 그대로 미완료 상태여야 한다.
  SELECT status INTO v_status FROM public.mission_progress WHERE session_id = v_session_id;
  IF v_status = 'COMPLETED' THEN
    RAISE EXCEPTION 'boredom rejection must not mark mission_progress as COMPLETED, got %', v_status;
  END IF;

  -- ── Fixture 3: R2 — 레거시 finalize_mission_turn_v1 경로가 v3 세션을
  --    자동완료·보상하지 않는지 직접 검증 (별도 business_date v_day+2) ─────
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at + interval '2 days', v_day + 2)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at,
    required_valid_count, valid_answer_count
  ) VALUES (
    v_session_id, v_child_id, (v_day + 2)::text, 'daily_single',
    'v3_single_daily', v_effective_at,
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
