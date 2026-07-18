-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 질문·대화 엔진 V2를 위한 원자적 트랜잭션 RPC 추가 (HIGH #1, MEDIUM #2 대응)

CREATE OR REPLACE FUNCTION record_v2_mission_answer(
  p_session_id UUID,
  p_child_id UUID,
  p_question_id UUID,
  p_answer_status TEXT,
  p_answer_classification TEXT,
  p_required_valid_count INT,
  p_reward_type TEXT
)
RETURNS TABLE (
  blocked BOOLEAN,
  valid_answer_count INT,
  completed BOOLEAN,
  newly_completed BOOLEAN,
  reward_status TEXT,
  status TEXT,
  question_states JSONB
) AS $$
DECLARE
  v_progress_status TEXT;
  v_prev_question_states JSONB;
  v_prev_valid_count INT;
  v_prev_state TEXT;
  v_new_state TEXT;
  v_progress_awarded_new BOOLEAN;
  v_valid_count INT;
  v_completed BOOLEAN;
  v_newly_completed BOOLEAN;
  v_reward_status TEXT := 'not_applicable';
  v_updated_states JSONB;
  
  -- 골드키 변수
  v_today_date DATE;
  v_daily_rewards_count INT;
  v_active_balance INT;
  v_new_ledger_id UUID;
BEGIN
  -- 1. mission_progress 행 잠금 (동시 답변 요청 직렬화)
  SELECT mission_progress.status, mission_progress.question_states, mission_progress.valid_answer_count INTO v_progress_status, v_prev_question_states, v_prev_valid_count
  FROM mission_progress
  WHERE session_id = p_session_id
  FOR UPDATE;

  -- 2. status 가 SAFETY_PAUSED 또는 COMPLETED 인 경우 차단
  IF v_progress_status = 'SAFETY_PAUSED' OR v_progress_status = 'COMPLETED' THEN
    RETURN QUERY SELECT true, COALESCE(v_prev_valid_count, 0), (v_progress_status = 'COMPLETED'), false, 'not_applicable'::text, v_progress_status, v_prev_question_states;
    RETURN;
  END IF;

  -- 3. 현재 질문 상태 읽기
  v_prev_state := COALESCE(v_prev_question_states->>p_question_id::text, 'pending');
  v_new_state := p_answer_status;

  -- 4. answered -> non-answered 역전 시 기존 progress_awarded=true 복구
  IF v_prev_state = 'answered' AND v_new_state <> 'answered' THEN
    UPDATE mission_question_history
    SET progress_awarded = false
    WHERE session_id = p_session_id
      AND question_id = p_question_id
      AND progress_awarded = true;
  END IF;

  -- 5. progress_awarded_new 계산
  v_progress_awarded_new := (v_prev_state <> 'answered' AND v_new_state = 'answered');

  -- 6. mission_question_history 에 새 행 기록
  INSERT INTO mission_question_history (
    child_id, question_id, answer_status, answer_classification, progress_awarded, session_id
  ) VALUES (
    p_child_id, p_question_id, p_answer_status, p_answer_classification, v_progress_awarded_new, p_session_id
  );

  -- 7. V2 유효답변 수 재계산 (VALID + progress_awarded=true 기준)
  SELECT COUNT(*)::INT INTO v_valid_count
  FROM mission_question_history
  WHERE session_id = p_session_id
    AND answer_classification = 'VALID'
    AND progress_awarded = true;

  -- 8. 완료 판정
  v_completed := (v_valid_count >= p_required_valid_count);
  v_newly_completed := (v_completed AND v_progress_status <> 'COMPLETED');

  -- 9. mission_progress 업데이트
  v_updated_states := v_prev_question_states || jsonb_build_object(p_question_id::text, v_new_state);
  
  UPDATE mission_progress
  SET question_states = v_updated_states,
      valid_answer_count = v_valid_count,
      updated_at = now(),
      status = CASE WHEN v_newly_completed THEN 'COMPLETED' ELSE mission_progress.status END
  WHERE session_id = p_session_id
  RETURNING mission_progress.status INTO v_progress_status;

  -- 10. 새로 완료된 경우 보상 및 정리 작업
  IF v_newly_completed THEN
    -- (a) 미사용 질문 UNUSED 정리 (role 필터 없이 PRIMARY와 RESERVE 모두)
    UPDATE mission_question_history
    SET termination_reason = 'COMPLETED'
    WHERE session_id = p_session_id
      AND asked_order IS NULL;

    -- (b) 골드키 지급 시도 (락으로 동시 지급 경합 제어)
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

      v_today_date := (now() AT TIME ZONE 'Asia/Seoul')::date;

      -- TS lib/goldkey/ledger.ts의 MISSION_DAILY_LIMIT과 반드시 동기화 (하루 한도 2개)
      SELECT COUNT(*)::INT INTO v_daily_rewards_count
      FROM gold_key_ledger
      WHERE child_id = p_child_id
        AND reason = 'mission'
        AND earned_at >= (v_today_date || ' 00:00:00+09')::timestamptz
        AND earned_at < ((v_today_date + 1) || ' 00:00:00+09')::timestamptz;

      IF v_daily_rewards_count >= 2 THEN
        v_reward_status := 'daily_limit_reached';
      ELSE
        -- 확정 정책(대표님 승인, 2026-07-18): 활성 골드키 보유 상한 22개.
        -- TS lib/goldkey/ledger.ts의 MAX_ACTIVE_BALANCE 상수와 반드시 동기화 유지.
        -- 상한 도달 시 미션은 정상 COMPLETED 처리되지만(이미 위에서 처리됨) 보상만 지급하지 않는다.
        -- 소급 지급 없음: mission_id+reward_type 멱등 키 + 세션 COMPLETED 후 RPC 재호출 자체가 blocked 체크로
        -- 차단되므로, 이후 잔액이 줄어도 이 미션에 대해 다시 지급을 시도하는 경로가 존재하지 않는다.
        -- 위에서 pg_advisory_xact_lock을 child_id 단위(날짜 무관)로 걸었으므로, 자정 경계를 걸친 동시 요청을
        -- 포함해 어떤 동시 완료 요청에서도 이 SELECT는 직렬화된 최신값을 읽어 22개를 초과해 지급하지 않는다.
        SELECT COUNT(*)::INT INTO v_active_balance
        FROM gold_key_ledger
        WHERE child_id = p_child_id
          AND consumed = false
          AND expires_at > now();

        IF v_active_balance >= 22 THEN
          v_reward_status := 'max_balance_reached';
        ELSE
          INSERT INTO gold_key_ledger (
            child_id, reason, mission_id, reward_type, expires_at
          ) VALUES (
            p_child_id, 'mission', p_session_id, p_reward_type, now() + interval '7 days'
          )
          ON CONFLICT (child_id, mission_id, reward_type) WHERE mission_id IS NOT NULL
          DO NOTHING
          RETURNING id INTO v_new_ledger_id;

          IF v_new_ledger_id IS NOT NULL THEN
            v_reward_status := 'awarded';
          ELSE
            v_reward_status := 'already_earned';
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- 예상 못한 데이터베이스 제약 조건 등은 호출부로 전파
      RAISE;
    END;
  END IF;

  RETURN QUERY SELECT false, v_valid_count, v_completed, v_newly_completed, v_reward_status, v_progress_status, v_updated_states;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION record_v2_mission_answer(UUID, UUID, UUID, TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_v2_mission_answer(UUID, UUID, UUID, TEXT, TEXT, INT, TEXT) TO service_role;


CREATE OR REPLACE FUNCTION record_v2_safety_pause(
  p_session_id UUID,
  p_child_id UUID,
  p_question_id UUID,
  p_answer_text TEXT,
  p_safety_subcategory TEXT
)
RETURNS TABLE (
  blocked BOOLEAN,
  history_id UUID
) AS $$
DECLARE
  v_progress_status TEXT;
  v_history_id UUID;
BEGIN
  -- 1. mission_progress 행 잠금
  SELECT status INTO v_progress_status
  FROM mission_progress
  WHERE session_id = p_session_id
  FOR UPDATE;

  -- 2. 이미 SAFETY_PAUSED 또는 COMPLETED 인 경우 차단
  IF v_progress_status = 'SAFETY_PAUSED' OR v_progress_status = 'COMPLETED' THEN
    RETURN QUERY SELECT true, NULL::UUID;
    RETURN;
  END IF;

  -- 3. mission_progress.status = 'SAFETY_PAUSED' 로 업데이트
  UPDATE mission_progress
  SET status = 'SAFETY_PAUSED',
      updated_at = now()
  WHERE session_id = p_session_id;

  -- 4. 미션 질문 이력에 SAFETY_SIGNAL 기록
  INSERT INTO mission_question_history (
    child_id, question_id, answer_status, answer_classification, session_id
  ) VALUES (
    p_child_id, p_question_id, 'skipped', 'SAFETY_SIGNAL', p_session_id
  )
  RETURNING id INTO v_history_id;

  -- 5. 남은 예비/일반 문항 termination_reason = 'SAFETY_PAUSED' 처리 (role 필터 없이)
  UPDATE mission_question_history
  SET termination_reason = 'SAFETY_PAUSED'
  WHERE session_id = p_session_id
    AND asked_order IS NULL;

  -- 6. safety_events 기록
  INSERT INTO safety_events (
    session_id, subcategory, child_text, source, child_id, question_history_id
  ) VALUES (
    p_session_id, p_safety_subcategory, p_answer_text, 'QUESTION_ENGINE', p_child_id, v_history_id
  );

  RETURN QUERY SELECT false, v_history_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION record_v2_safety_pause(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_v2_safety_pause(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
