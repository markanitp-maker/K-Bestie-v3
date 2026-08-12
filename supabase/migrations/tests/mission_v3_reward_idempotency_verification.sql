-- 073 Phase 4/5A/5C Dev 전용 검증. 모든 fixture/결과는 마지막 ROLLBACK으로 제거한다.
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
  v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_day_at timestamptz;
  v_effective_at timestamptz := now() - interval '1 minute';
  v_count integer;
  v_status text;
  v_reward record;
  v_finalize record;
  v_start record;
  v_assessed record;
  v_output record;
  v_goal_id uuid;
  v_other_goal_id uuid;
  v_first_assessment jsonb := '[{"goalId":"goal-r2","status":"PARTIAL","confidence":0.5,"evidenceSource":"child_utterance"}]'::jsonb;
  v_conflicting_assessment jsonb := '[{"goalId":"goal-r2","status":"SATISFIED","confidence":0.9,"evidenceSource":"child_utterance"}]'::jsonb;
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
  IF v_reward.rewarded IS DISTINCT FROM true
    OR v_reward.reason IS DISTINCT FROM 'rewarded'
    OR v_reward.satisfied_goal_count IS DISTINCT FROM 3
  THEN
    RAISE EXCEPTION 'expected first award to succeed: %', row_to_json(v_reward);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id AND reward_type = 'mission_v3_complete' AND business_date = v_day;
  IF v_count IS DISTINCT FROM 1 THEN
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
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'F1 regression: completion trigger must record exactly 1 mission_complete event row, got %', v_count;
  END IF;

  -- 2) 재시도/reopen: 같은 키로 20회 순차 재호출해도 행은 여전히 1개, 전부
  --    already_rewarded. (동시 호출이 아니라 순차 반복 검증 — 위 F2 참고.)
  FOR i IN 1..20 LOOP
    SELECT * INTO v_reward FROM public.award_mission_v3_reward(
      v_child_id, v_day, 'mission_v3_complete', v_session_id
    );
    IF v_reward.rewarded IS DISTINCT FROM false
      OR v_reward.reason IS DISTINCT FROM 'already_rewarded'
    THEN
      RAISE EXCEPTION 'retry %/20 must be a no-op: %', i, row_to_json(v_reward);
    END IF;
  END LOOP;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id AND reward_type = 'mission_v3_complete' AND business_date = v_day;
  IF v_count IS DISTINCT FROM 1 THEN
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
  IF v_count IS DISTINCT FROM 1 THEN
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
  IF v_reward.rewarded IS DISTINCT FROM false
    OR v_reward.reason IS DISTINCT FROM 'goal_threshold_not_met'
    OR v_reward.satisfied_goal_count IS DISTINCT FROM 2
  THEN
    RAISE EXCEPTION 'boredom (Goal 2/4) must be rejected with goal_threshold_not_met: %', row_to_json(v_reward);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id AND reward_type = 'mission_v3_complete' AND business_date = v_day + 1;
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'boredom rejection must not create any ledger row, got %', v_count;
  END IF;

  -- Boredom 거부는 완료가 아니므로 status도 그대로 미완료 상태여야 한다.
  SELECT status INTO v_status FROM public.mission_progress WHERE session_id = v_session_id;
  IF v_status IS NOT DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'boredom rejection must not mark mission_progress as COMPLETED, got %', v_status;
  END IF;

  -- ── Fixture 3: R2/Phase 5A gate fix — 실제 v3 start → assessed → shared
  --    finalize 경로가 K 응답 저장에 도달하되 레거시 완료·보상은 하지 않는지
  --    직접 검증한다 (별도 business_date v_day+2). ──────────────────────────
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at + interval '2 days', v_day + 2)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at,
    required_valid_count, valid_answer_count, status
  ) VALUES (
    v_session_id, v_child_id, (v_day + 2)::text, 'daily_single',
    'v3_single_daily', v_effective_at,
    1, 1, 'IN_PROGRESS'  -- valid_answer_count >= required_valid_count: 레거시 기준으로는 "완료"로 보인다
  );

  SELECT * INTO v_start FROM public.start_mission_turn_v3(
    v_session_id, 'r2-turn-1', '레거시 완료 판정 회귀 테스트', 'stt_tts', 1
  );
  IF v_start.turn_status IS DISTINCT FROM 'CHILD_PERSISTED'
    OR v_start.answer_result IS NOT NULL
    OR v_start.already_processed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'v3 start must persist a fresh child turn: %', row_to_json(v_start);
  END IF;

  SELECT * INTO v_assessed FROM public.mark_mission_turn_v3_assessed(
    v_session_id, 'r2-turn-1', v_first_assessment
  );
  IF v_assessed.turn_status IS DISTINCT FROM 'ANSWER_PROCESSED'
    OR v_assessed.already_assessed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'v3 assessed transition must make the turn finalizable: %', row_to_json(v_assessed);
  END IF;

  -- C2 regression: a retry between assessment and finalize receives the first
  -- result, but the fresh 30-second output-processing lease blocks duplicate work.
  SELECT * INTO v_start FROM public.start_mission_turn_v3(
    v_session_id, 'r2-turn-1', '레거시 완료 판정 회귀 테스트', 'stt_tts', 1
  );
  IF v_start.turn_status IS DISTINCT FROM 'ANSWER_PROCESSED'
    OR v_start.answer_result IS DISTINCT FROM v_first_assessment
    OR v_start.already_processed IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v3 start retry must return the stored assessment under an active processing lease: %', row_to_json(v_start);
  END IF;

  -- A non-deterministic conflicting retry is also a no-op. First writer wins.
  SELECT * INTO v_assessed FROM public.mark_mission_turn_v3_assessed(
    v_session_id, 'r2-turn-1', v_conflicting_assessment
  );
  IF v_assessed.turn_status IS DISTINCT FROM 'ANSWER_PROCESSED'
    OR v_assessed.already_assessed IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v3 conflicting assessed retry must preserve the first result: %', row_to_json(v_assessed);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mission_turns
    WHERE session_id = v_session_id AND client_turn_id = 'r2-turn-1'
      AND status = 'ANSWER_PROCESSED' AND answer_result = v_first_assessment
  ) THEN
    RAISE EXCEPTION 'v3 assessed retry must leave the first answer_result unchanged before finalize';
  END IF;

  SELECT * INTO v_finalize FROM public.finalize_mission_turn_v1(
    v_session_id, 'r2-turn-1', '레거시 완료 판정 회귀 테스트에 대한 케이 응답', 'r2-turn-1:k', 2, false
  );

  IF v_finalize.completed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'R2 regression: finalize_mission_turn_v1 must never auto-complete a v3_single_daily session, got completed=true';
  END IF;
  IF v_finalize.reward_status IS DISTINCT FROM 'none' THEN
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

  IF NOT EXISTS (
    SELECT 1 FROM public.mission_turns
    WHERE session_id = v_session_id AND client_turn_id = 'r2-turn-1'
      AND status = 'FINALIZED' AND k_message_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'shared finalize must persist the K response after v3 assessed transition';
  END IF;

  SELECT * INTO v_start FROM public.start_mission_turn_v3(
    v_session_id, 'r2-turn-1', '레거시 완료 판정 회귀 테스트', 'stt_tts', 1
  );
  IF v_start.turn_status IS DISTINCT FROM 'FINALIZED'
    OR v_start.answer_result IS DISTINCT FROM v_first_assessment
    OR v_start.already_processed IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v3 finalized retry must return the first assessment and processed flag: %', row_to_json(v_start);
  END IF;

  -- ── Fixture 4: 정상 output first-writer → finalize → terminal retry ───────
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at + interval '3 days', v_day + 3)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at,
    required_valid_count, valid_answer_count, status
  ) VALUES (
    v_session_id, v_child_id, (v_day + 3)::text, 'daily_single',
    'v3_single_daily', v_effective_at,
    1, 0, 'IN_PROGRESS'
  );

  INSERT INTO public.conversation_goals(
    mission_session_id, child_id, goal_order, semantic_group, priority, status
  )
  SELECT v_session_id, v_child_id, ord, 'OUTPUT_GROUP_' || ord, 'P2', 'PENDING'
  FROM generate_series(1, 4) AS ord;

  SELECT goal_id INTO v_goal_id
  FROM public.conversation_goals
  WHERE mission_session_id = v_session_id AND goal_order = 1;

  SELECT goal_id INTO v_other_goal_id
  FROM public.conversation_goals
  WHERE mission_session_id = v_session_id AND goal_order = 2;

  SELECT * INTO v_start FROM public.start_mission_turn_v3(
    v_session_id, 'output-turn-1', '오늘은 과학 시간이 재미있었어', 'stt_tts', 1
  );
  IF v_start.turn_status IS DISTINCT FROM 'CHILD_PERSISTED'
    OR v_start.answer_result IS NOT NULL
    OR v_start.k_response_draft IS NOT NULL
    OR v_start.previous_prompted_goal_id IS NOT NULL
    OR v_start.prompted_goal_id IS NOT NULL
    OR v_start.engine_category IS NOT NULL
    OR v_start.safety_subcategory IS NOT NULL
    OR v_start.boredom_early_finish IS DISTINCT FROM false
    OR v_start.already_processed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'fresh v3 output fixture must start with an empty output boundary: %', row_to_json(v_start);
  END IF;

  SELECT * INTO v_assessed FROM public.mark_mission_turn_v3_assessed(
    v_session_id, 'output-turn-1', v_first_assessment
  );
  IF v_assessed.turn_status IS DISTINCT FROM 'ANSWER_PROCESSED'
    OR v_assessed.already_assessed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'normal output fixture assessment failed: %', row_to_json(v_assessed);
  END IF;

  -- 1) 최초 output의 여섯 반환 필드와 실제 mission_turns 저장값을 모두 확인한다.
  SELECT * INTO v_output FROM public.store_mission_turn_v3_output(
    v_session_id,
    'output-turn-1',
    '첫 번째 K 응답',
    v_goal_id,
    'generated',
    NULL,
    false
  );
  IF v_output.k_response_draft IS DISTINCT FROM '첫 번째 K 응답'
    OR v_output.prompted_goal_id IS DISTINCT FROM v_goal_id
    OR v_output.engine_category IS DISTINCT FROM 'generated'
    OR v_output.safety_subcategory IS NOT NULL
    OR v_output.boredom_early_finish IS DISTINCT FROM false
    OR v_output.already_stored IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'first output store must return the exact first-writer values: %', row_to_json(v_output);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mission_turns
    WHERE session_id = v_session_id
      AND client_turn_id = 'output-turn-1'
      AND k_response_draft IS NOT DISTINCT FROM '첫 번째 K 응답'
      AND prompted_goal_id IS NOT DISTINCT FROM v_goal_id
      AND engine_category IS NOT DISTINCT FROM 'generated'
      AND safety_subcategory IS NULL
      AND boredom_early_finish IS NOT DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'first output store must persist every first-writer field unchanged';
  END IF;

  -- 2) 모든 필드가 충돌하는 후발 output은 무시되고 최초 값이 그대로 반환된다.
  SELECT * INTO v_output FROM public.store_mission_turn_v3_output(
    v_session_id,
    'output-turn-1',
    '충돌하는 후발 K 응답',
    v_other_goal_id,
    'deterministic',
    'violence',
    true
  );
  IF v_output.k_response_draft IS DISTINCT FROM '첫 번째 K 응답'
    OR v_output.prompted_goal_id IS DISTINCT FROM v_goal_id
    OR v_output.engine_category IS DISTINCT FROM 'generated'
    OR v_output.safety_subcategory IS NOT NULL
    OR v_output.boredom_early_finish IS DISTINCT FROM false
    OR v_output.already_stored IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'conflicting output retry must return every first-writer value: %', row_to_json(v_output);
  END IF;

  -- 3) 정상 finalize는 후발 인자가 아니라 저장된 최초 output으로 K 메시지를 만든다.
  SELECT * INTO v_finalize FROM public.finalize_mission_turn_v3(
    v_session_id, 'output-turn-1', 2
  );
  IF v_finalize.progress_status IS DISTINCT FROM 'IN_PROGRESS'
    OR v_finalize.k_response IS DISTINCT FROM '첫 번째 K 응답'
    OR v_finalize.prompted_goal_id IS DISTINCT FROM v_goal_id
    OR v_finalize.safety_paused IS DISTINCT FROM false
    OR v_finalize.early_ended IS DISTINCT FROM false
    OR v_finalize.already_finalized IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'normal v3 finalize must use the persisted first output: %', row_to_json(v_finalize);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.chat_messages
  WHERE session_id = v_session_id AND turn_id = 'output-turn-1:k' AND role = 'k';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'normal finalize must persist exactly one K response, got %', v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_messages
    WHERE session_id = v_session_id
      AND turn_id = 'output-turn-1:k'
      AND role = 'k'
      AND content IS NOT DISTINCT FROM '첫 번째 K 응답'
      AND display_sequence IS NOT DISTINCT FROM 2
  ) THEN
    RAISE EXCEPTION 'normal finalize must persist the first output and first display sequence';
  END IF;

  -- 4) FINALIZED 뒤 output/finalize 재시도도 최초 terminal 결과만 반환한다.
  SELECT * INTO v_output FROM public.store_mission_turn_v3_output(
    v_session_id,
    'output-turn-1',
    'FINALIZED 뒤 재계산된 응답',
    v_other_goal_id,
    'safety',
    'self_harm',
    true
  );
  IF v_output.k_response_draft IS DISTINCT FROM '첫 번째 K 응답'
    OR v_output.prompted_goal_id IS DISTINCT FROM v_goal_id
    OR v_output.engine_category IS DISTINCT FROM 'generated'
    OR v_output.safety_subcategory IS NOT NULL
    OR v_output.boredom_early_finish IS DISTINCT FROM false
    OR v_output.already_stored IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'post-finalize output retry must not replace any first-writer field: %', row_to_json(v_output);
  END IF;

  SELECT * INTO v_finalize FROM public.finalize_mission_turn_v3(
    v_session_id, 'output-turn-1', 99
  );
  IF v_finalize.progress_status IS DISTINCT FROM 'IN_PROGRESS'
    OR v_finalize.k_response IS DISTINCT FROM '첫 번째 K 응답'
    OR v_finalize.prompted_goal_id IS DISTINCT FROM v_goal_id
    OR v_finalize.safety_paused IS DISTINCT FROM false
    OR v_finalize.early_ended IS DISTINCT FROM false
    OR v_finalize.already_finalized IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'post-finalize retry must return the first terminal result: %', row_to_json(v_finalize);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.chat_messages
  WHERE session_id = v_session_id AND turn_id = 'output-turn-1:k' AND role = 'k';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'post-finalize retries must leave exactly one K response, got %', v_count;
  END IF;

  -- ── Fixture 5: safety → SAFETY_PAUSED, K/event exactly once ──────────────
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at + interval '4 days', v_day + 4)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at,
    required_valid_count, valid_answer_count, status
  ) VALUES (
    v_session_id, v_child_id, (v_day + 4)::text, 'daily_single',
    'v3_single_daily', v_effective_at,
    1, 0, 'IN_PROGRESS'
  );

  SELECT * INTO v_start FROM public.start_mission_turn_v3(
    v_session_id, 'safety-turn-1', '친구한테 맞았어', 'stt_tts', 1
  );
  IF v_start.turn_status IS DISTINCT FROM 'CHILD_PERSISTED'
    OR v_start.already_processed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'safety fixture start failed: %', row_to_json(v_start);
  END IF;

  SELECT * INTO v_assessed FROM public.mark_mission_turn_v3_assessed(
    v_session_id, 'safety-turn-1', '[]'::jsonb
  );
  IF v_assessed.turn_status IS DISTINCT FROM 'ANSWER_PROCESSED'
    OR v_assessed.already_assessed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'safety fixture assessment failed: %', row_to_json(v_assessed);
  END IF;

  SELECT * INTO v_output FROM public.store_mission_turn_v3_output(
    v_session_id,
    'safety-turn-1',
    '그랬구나. 네 잘못이 아니야. 지금 안전한 어른에게 바로 알리자.',
    NULL,
    'safety',
    'violence',
    false
  );
  IF v_output.k_response_draft IS DISTINCT FROM '그랬구나. 네 잘못이 아니야. 지금 안전한 어른에게 바로 알리자.'
    OR v_output.prompted_goal_id IS NOT NULL
    OR v_output.engine_category IS DISTINCT FROM 'safety'
    OR v_output.safety_subcategory IS DISTINCT FROM 'violence'
    OR v_output.boredom_early_finish IS DISTINCT FROM false
    OR v_output.already_stored IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'safety output store must preserve the exact safety payload: %', row_to_json(v_output);
  END IF;

  SELECT * INTO v_finalize FROM public.finalize_mission_turn_v3(
    v_session_id, 'safety-turn-1', 2
  );
  IF v_finalize.progress_status IS DISTINCT FROM 'SAFETY_PAUSED'
    OR v_finalize.k_response IS DISTINCT FROM '그랬구나. 네 잘못이 아니야. 지금 안전한 어른에게 바로 알리자.'
    OR v_finalize.prompted_goal_id IS NOT NULL
    OR v_finalize.safety_paused IS DISTINCT FROM true
    OR v_finalize.early_ended IS DISTINCT FROM false
    OR v_finalize.already_finalized IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'safety finalize must pause the mission with the first K response: %', row_to_json(v_finalize);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.chat_messages
  WHERE session_id = v_session_id AND turn_id = 'safety-turn-1:k' AND role = 'k';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'safety finalize must persist exactly one K response, got %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chat_messages
    WHERE session_id = v_session_id
      AND turn_id = 'safety-turn-1:k'
      AND role = 'k'
      AND content IS NOT DISTINCT FROM '그랬구나. 네 잘못이 아니야. 지금 안전한 어른에게 바로 알리자.'
  ) THEN
    RAISE EXCEPTION 'safety finalize must persist the exact first K response';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.safety_events
  WHERE session_id = v_session_id
    AND child_id = v_child_id
    AND subcategory = 'violence'
    AND child_text = '친구한테 맞았어'
    AND source = 'QUESTION_ENGINE'
    AND event_stage = 'mission_turn'
    AND policy_version = 'v3_single_daily';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'safety finalize must create exactly one matching safety event, got %', v_count;
  END IF;

  SELECT * INTO v_output FROM public.store_mission_turn_v3_output(
    v_session_id,
    'safety-turn-1',
    '재시도에서 생성된 다른 응답',
    NULL,
    'generated',
    NULL,
    true
  );
  IF v_output.k_response_draft IS DISTINCT FROM '그랬구나. 네 잘못이 아니야. 지금 안전한 어른에게 바로 알리자.'
    OR v_output.prompted_goal_id IS NOT NULL
    OR v_output.engine_category IS DISTINCT FROM 'safety'
    OR v_output.safety_subcategory IS DISTINCT FROM 'violence'
    OR v_output.boredom_early_finish IS DISTINCT FROM false
    OR v_output.already_stored IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'safety output retry must return the first safety payload: %', row_to_json(v_output);
  END IF;

  SELECT * INTO v_finalize FROM public.finalize_mission_turn_v3(
    v_session_id, 'safety-turn-1', 77
  );
  IF v_finalize.progress_status IS DISTINCT FROM 'SAFETY_PAUSED'
    OR v_finalize.k_response IS DISTINCT FROM '그랬구나. 네 잘못이 아니야. 지금 안전한 어른에게 바로 알리자.'
    OR v_finalize.prompted_goal_id IS NOT NULL
    OR v_finalize.safety_paused IS DISTINCT FROM true
    OR v_finalize.early_ended IS DISTINCT FROM false
    OR v_finalize.already_finalized IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'safety finalize retry must return the same terminal result: %', row_to_json(v_finalize);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.safety_events
  WHERE session_id = v_session_id;
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'safety retries must leave exactly one safety event, got %', v_count;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.chat_messages
  WHERE session_id = v_session_id AND turn_id = 'safety-turn-1:k' AND role = 'k';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'safety retries must leave exactly one K response, got %', v_count;
  END IF;

  -- ── Fixture 6: boredom Goal 2/4 → FORCE_ENDED, no reward, retry-safe ─────
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at + interval '5 days', v_day + 5)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at,
    required_valid_count, valid_answer_count, status
  ) VALUES (
    v_session_id, v_child_id, (v_day + 5)::text, 'daily_single',
    'v3_single_daily', v_effective_at,
    1, 0, 'IN_PROGRESS'
  );

  INSERT INTO public.conversation_goals(
    mission_session_id, child_id, goal_order, semantic_group, priority, status,
    evidence_source, confidence, satisfied_at
  )
  SELECT v_session_id, v_child_id, ord, 'TERMINAL_BOREDOM_' || ord, 'P2',
    CASE WHEN ord <= 2 THEN 'SATISFIED' ELSE 'PENDING' END,
    CASE WHEN ord <= 2 THEN 'child_utterance' ELSE NULL END,
    CASE WHEN ord <= 2 THEN 0.9 ELSE NULL END,
    CASE WHEN ord <= 2 THEN v_day_at + interval '5 days' ELSE NULL END
  FROM generate_series(1, 4) AS ord;

  SELECT * INTO v_start FROM public.start_mission_turn_v3(
    v_session_id, 'boredom-turn-1', '이제 그만하고 싶어', 'stt_tts', 1
  );
  IF v_start.turn_status IS DISTINCT FROM 'CHILD_PERSISTED'
    OR v_start.already_processed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'boredom fixture start failed: %', row_to_json(v_start);
  END IF;

  SELECT * INTO v_assessed FROM public.mark_mission_turn_v3_assessed(
    v_session_id, 'boredom-turn-1', '[]'::jsonb
  );
  IF v_assessed.turn_status IS DISTINCT FROM 'ANSWER_PROCESSED'
    OR v_assessed.already_assessed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'boredom fixture assessment failed: %', row_to_json(v_assessed);
  END IF;

  SELECT * INTO v_output FROM public.store_mission_turn_v3_output(
    v_session_id,
    'boredom-turn-1',
    '알겠어. 오늘 이야기는 여기까지 하자.',
    NULL,
    'deterministic',
    NULL,
    true
  );
  IF v_output.k_response_draft IS DISTINCT FROM '알겠어. 오늘 이야기는 여기까지 하자.'
    OR v_output.prompted_goal_id IS NOT NULL
    OR v_output.engine_category IS DISTINCT FROM 'deterministic'
    OR v_output.safety_subcategory IS NOT NULL
    OR v_output.boredom_early_finish IS DISTINCT FROM true
    OR v_output.already_stored IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'boredom output store failed: %', row_to_json(v_output);
  END IF;

  SELECT * INTO v_finalize FROM public.finalize_mission_turn_v3(
    v_session_id, 'boredom-turn-1', 2
  );
  IF v_finalize.progress_status IS DISTINCT FROM 'FORCE_ENDED'
    OR v_finalize.k_response IS DISTINCT FROM '알겠어. 오늘 이야기는 여기까지 하자.'
    OR v_finalize.prompted_goal_id IS NOT NULL
    OR v_finalize.safety_paused IS DISTINCT FROM false
    OR v_finalize.early_ended IS DISTINCT FROM true
    OR v_finalize.already_finalized IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'Goal 2/4 boredom finalize must force-end without safety pause: %', row_to_json(v_finalize);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chat_sessions
    WHERE id = v_session_id
      AND ended_at IS NOT NULL
      AND ended_reason IS NOT DISTINCT FROM 'BOREDOM_EARLY_FINISH'
  ) THEN
    RAISE EXCEPTION 'boredom finalize must persist the terminal session reason';
  END IF;

  SELECT * INTO v_reward FROM public.award_mission_v3_reward(
    v_child_id, v_day + 5, 'mission_v3_complete', v_session_id
  );
  IF v_reward.rewarded IS DISTINCT FROM false
    OR v_reward.eligible IS DISTINCT FROM false
    OR v_reward.reason IS DISTINCT FROM 'goal_threshold_not_met'
    OR v_reward.satisfied_goal_count IS DISTINCT FROM 2
  THEN
    RAISE EXCEPTION 'Goal 2/4 boredom path must remain ineligible for reward: %', row_to_json(v_reward);
  END IF;

  SELECT * INTO v_output FROM public.store_mission_turn_v3_output(
    v_session_id,
    'boredom-turn-1',
    '재시도의 다른 종료 응답',
    NULL,
    'generated',
    NULL,
    false
  );
  IF v_output.k_response_draft IS DISTINCT FROM '알겠어. 오늘 이야기는 여기까지 하자.'
    OR v_output.prompted_goal_id IS NOT NULL
    OR v_output.engine_category IS DISTINCT FROM 'deterministic'
    OR v_output.safety_subcategory IS NOT NULL
    OR v_output.boredom_early_finish IS DISTINCT FROM true
    OR v_output.already_stored IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'boredom output retry must preserve the first terminal payload: %', row_to_json(v_output);
  END IF;

  SELECT * INTO v_finalize FROM public.finalize_mission_turn_v3(
    v_session_id, 'boredom-turn-1', 88
  );
  IF v_finalize.progress_status IS DISTINCT FROM 'FORCE_ENDED'
    OR v_finalize.k_response IS DISTINCT FROM '알겠어. 오늘 이야기는 여기까지 하자.'
    OR v_finalize.prompted_goal_id IS NOT NULL
    OR v_finalize.safety_paused IS DISTINCT FROM false
    OR v_finalize.early_ended IS DISTINCT FROM true
    OR v_finalize.already_finalized IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'boredom finalize retry must return the first terminal result: %', row_to_json(v_finalize);
  END IF;

  SELECT * INTO v_reward FROM public.award_mission_v3_reward(
    v_child_id, v_day + 5, 'mission_v3_complete', v_session_id
  );
  IF v_reward.rewarded IS DISTINCT FROM false
    OR v_reward.eligible IS DISTINCT FROM false
    OR v_reward.reason IS DISTINCT FROM 'goal_threshold_not_met'
    OR v_reward.satisfied_goal_count IS DISTINCT FROM 2
  THEN
    RAISE EXCEPTION 'boredom reward retry must remain the same no-op result: %', row_to_json(v_reward);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id
    AND reward_type = 'mission_v3_complete'
    AND business_date = v_day + 5;
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Goal 2/4 boredom retries must create zero reward rows, got %', v_count;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.chat_messages
  WHERE session_id = v_session_id AND turn_id = 'boredom-turn-1:k' AND role = 'k';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'boredom retries must leave exactly one K response, got %', v_count;
  END IF;

  -- ── Fixture 7: Goal 3/4 finalize → COMPLETED + exactly-once reward ────────
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at + interval '6 days', v_day + 6)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at,
    required_valid_count, valid_answer_count, status
  ) VALUES (
    v_session_id, v_child_id, (v_day + 6)::text, 'daily_single',
    'v3_single_daily', v_effective_at,
    1, 0, 'IN_PROGRESS'
  );

  INSERT INTO public.conversation_goals(
    mission_session_id, child_id, goal_order, semantic_group, priority, status,
    evidence_source, confidence, satisfied_at
  )
  SELECT v_session_id, v_child_id, ord, 'TERMINAL_COMPLETE_' || ord, 'P2',
    CASE WHEN ord <= 2 THEN 'SATISFIED' ELSE 'PENDING' END,
    CASE WHEN ord <= 2 THEN 'child_utterance' ELSE NULL END,
    CASE WHEN ord <= 2 THEN 0.9 ELSE NULL END,
    CASE WHEN ord <= 2 THEN v_day_at + interval '6 days' ELSE NULL END
  FROM generate_series(1, 4) AS ord;

  SELECT goal_id INTO v_goal_id
  FROM public.conversation_goals
  WHERE mission_session_id = v_session_id AND goal_order = 4;

  SELECT * INTO v_start FROM public.start_mission_turn_v3(
    v_session_id, 'complete-turn-1', '오늘 이야기 즐거웠어', 'stt_tts', 1
  );
  IF v_start.turn_status IS DISTINCT FROM 'CHILD_PERSISTED'
    OR v_start.already_processed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'completion fixture start failed: %', row_to_json(v_start);
  END IF;

  SELECT * INTO v_assessed FROM public.mark_mission_turn_v3_assessed(
    v_session_id, 'complete-turn-1', '[]'::jsonb
  );
  IF v_assessed.turn_status IS DISTINCT FROM 'ANSWER_PROCESSED'
    OR v_assessed.already_assessed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'completion fixture assessment failed: %', row_to_json(v_assessed);
  END IF;

  -- start 시점에는 2/4였고, 이번 assessment가 세 번째 Goal을 충족시킨 상황이다.
  UPDATE public.conversation_goals
  SET status = 'SATISFIED',
      evidence_source = 'child_utterance',
      confidence = 0.9,
      satisfied_at = v_day_at + interval '6 days',
      updated_at = now()
  WHERE mission_session_id = v_session_id AND goal_order = 3;

  SELECT * INTO v_output FROM public.store_mission_turn_v3_output(
    v_session_id,
    'complete-turn-1',
    '나도 즐거웠어. 오늘 미션을 완료했어!',
    v_goal_id,
    'generated',
    NULL,
    false
  );
  IF v_output.k_response_draft IS DISTINCT FROM '나도 즐거웠어. 오늘 미션을 완료했어!'
    OR v_output.prompted_goal_id IS DISTINCT FROM v_goal_id
    OR v_output.engine_category IS DISTINCT FROM 'generated'
    OR v_output.safety_subcategory IS NOT NULL
    OR v_output.boredom_early_finish IS DISTINCT FROM false
    OR v_output.already_stored IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'completion output store failed: %', row_to_json(v_output);
  END IF;

  SELECT * INTO v_finalize FROM public.finalize_mission_turn_v3(
    v_session_id, 'complete-turn-1', 2
  );
  IF v_finalize.progress_status IS DISTINCT FROM 'IN_PROGRESS'
    OR v_finalize.k_response IS DISTINCT FROM '나도 즐거웠어. 오늘 미션을 완료했어!'
    OR v_finalize.prompted_goal_id IS DISTINCT FROM v_goal_id
    OR v_finalize.safety_paused IS DISTINCT FROM false
    OR v_finalize.early_ended IS DISTINCT FROM false
    OR v_finalize.already_finalized IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'Goal 3/4 terminal finalize must persist the first K output before reward: %', row_to_json(v_finalize);
  END IF;

  SELECT * INTO v_reward FROM public.award_mission_v3_reward(
    v_child_id, v_day + 6, 'mission_v3_complete', v_session_id
  );
  IF v_reward.rewarded IS DISTINCT FROM true
    OR v_reward.eligible IS DISTINCT FROM true
    OR v_reward.reason IS DISTINCT FROM 'rewarded'
    OR v_reward.satisfied_goal_count IS DISTINCT FROM 3
  THEN
    RAISE EXCEPTION 'Goal 3/4 completion must award exactly once: %', row_to_json(v_reward);
  END IF;

  SELECT status INTO v_status
  FROM public.mission_progress
  WHERE session_id = v_session_id;
  IF v_status IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'Goal 3/4 reward path must transition progress to COMPLETED, got %', v_status;
  END IF;

  SELECT * INTO v_output FROM public.store_mission_turn_v3_output(
    v_session_id,
    'complete-turn-1',
    '완료 뒤 재계산된 응답',
    NULL,
    'deterministic',
    'threat',
    true
  );
  IF v_output.k_response_draft IS DISTINCT FROM '나도 즐거웠어. 오늘 미션을 완료했어!'
    OR v_output.prompted_goal_id IS DISTINCT FROM v_goal_id
    OR v_output.engine_category IS DISTINCT FROM 'generated'
    OR v_output.safety_subcategory IS NOT NULL
    OR v_output.boredom_early_finish IS DISTINCT FROM false
    OR v_output.already_stored IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'completed output retry must return the first output without recalculation: %', row_to_json(v_output);
  END IF;

  SELECT * INTO v_finalize FROM public.finalize_mission_turn_v3(
    v_session_id, 'complete-turn-1', 66
  );
  IF v_finalize.progress_status IS DISTINCT FROM 'COMPLETED'
    OR v_finalize.k_response IS DISTINCT FROM '나도 즐거웠어. 오늘 미션을 완료했어!'
    OR v_finalize.prompted_goal_id IS DISTINCT FROM v_goal_id
    OR v_finalize.safety_paused IS DISTINCT FROM false
    OR v_finalize.early_ended IS DISTINCT FROM false
    OR v_finalize.already_finalized IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'completed finalize retry must return the first terminal result: %', row_to_json(v_finalize);
  END IF;

  SELECT * INTO v_reward FROM public.award_mission_v3_reward(
    v_child_id, v_day + 6, 'mission_v3_complete', v_session_id
  );
  IF v_reward.rewarded IS DISTINCT FROM false
    OR v_reward.eligible IS DISTINCT FROM true
    OR v_reward.reason IS DISTINCT FROM 'already_rewarded'
    OR v_reward.satisfied_goal_count IS DISTINCT FROM 3
  THEN
    RAISE EXCEPTION 'Goal 3/4 reward retry must report already_rewarded: %', row_to_json(v_reward);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.gold_key_ledger
  WHERE child_id = v_child_id
    AND reward_type = 'mission_v3_complete'
    AND business_date = v_day + 6;
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Goal 3/4 retries must leave exactly one reward row, got %', v_count;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.chat_messages
  WHERE session_id = v_session_id AND turn_id = 'complete-turn-1:k' AND role = 'k';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Goal 3/4 retries must leave exactly one K response, got %', v_count;
  END IF;

  -- ── Fixture 8: 30초 output-processing lease와 assessment 재사용 ─────────
  INSERT INTO public.chat_sessions(child_id, session_type, started_at, business_date)
  VALUES (v_child_id, 'mission', v_day_at + interval '7 days', v_day + 7)
  RETURNING id INTO v_session_id;

  INSERT INTO public.mission_progress(
    session_id, child_id, business_date, round_type,
    mission_policy_version, effective_at,
    required_valid_count, valid_answer_count, status
  ) VALUES (
    v_session_id, v_child_id, (v_day + 7)::text, 'daily_single',
    'v3_single_daily', v_effective_at,
    1, 0, 'IN_PROGRESS'
  );

  SELECT * INTO v_start FROM public.start_mission_turn_v3(
    v_session_id, 'lease-turn-1', '처리 임대 검증 발화', 'stt_tts', 1
  );
  IF v_start.turn_status IS DISTINCT FROM 'CHILD_PERSISTED'
    OR v_start.answer_result IS NOT NULL
    OR v_start.already_processed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'lease fixture start failed: %', row_to_json(v_start);
  END IF;

  SELECT * INTO v_assessed FROM public.mark_mission_turn_v3_assessed(
    v_session_id, 'lease-turn-1', v_first_assessment
  );
  IF v_assessed.turn_status IS DISTINCT FROM 'ANSWER_PROCESSED'
    OR v_assessed.already_assessed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'lease fixture assessment failed: %', row_to_json(v_assessed);
  END IF;

  -- lease 안의 즉시 재호출: 저장된 assessment는 돌려주되 duplicate work는 막는다.
  SELECT * INTO v_start FROM public.start_mission_turn_v3(
    v_session_id, 'lease-turn-1', '처리 임대 검증 발화', 'stt_tts', 1
  );
  IF v_start.turn_status IS DISTINCT FROM 'ANSWER_PROCESSED'
    OR v_start.answer_result IS DISTINCT FROM v_first_assessment
    OR v_start.k_response_draft IS NOT NULL
    OR v_start.already_processed IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'retry inside the 30-second lease must be blocked with the stored assessment: %', row_to_json(v_start);
  END IF;

  -- 외부 LLM 작업 중 worker가 사라진 상황을 fixture에서 31초 경과로 재현한다.
  UPDATE public.mission_turns
  SET updated_at = now() - interval '31 seconds'
  WHERE session_id = v_session_id AND client_turn_id = 'lease-turn-1';

  -- lease 만료 뒤 재호출: 같은 assessment를 재사용하면서 output 생성을 재개할 수 있다.
  SELECT * INTO v_start FROM public.start_mission_turn_v3(
    v_session_id, 'lease-turn-1', '처리 임대 검증 발화', 'stt_tts', 1
  );
  IF v_start.turn_status IS DISTINCT FROM 'ANSWER_PROCESSED'
    OR v_start.answer_result IS DISTINCT FROM v_first_assessment
    OR v_start.k_response_draft IS NOT NULL
    OR v_start.already_processed IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'retry after lease expiry must resume from the stored assessment: %', row_to_json(v_start);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mission_turns
    WHERE session_id = v_session_id
      AND client_turn_id = 'lease-turn-1'
      AND status IS NOT DISTINCT FROM 'ANSWER_PROCESSED'
      AND answer_result IS NOT DISTINCT FROM v_first_assessment
      AND attempt_count IS NOT DISTINCT FROM 3
  ) THEN
    RAISE EXCEPTION 'lease retries must preserve the assessment and increment attempt_count to 3';
  END IF;

  RAISE NOTICE '073 Phase 4/5A/5C reward, terminal contract, and lease verification: PASSED';
END;
$$;

ROLLBACK;
