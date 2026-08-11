-- 089: 30일 이벤트 활동을 KST 날짜별로 미션 1회 + 자유대화 1회만 집계한다.
-- 기존 원장 행은 백필/수정하지 않는다. 신규 컬럼은 과거 행에서 NULL로 남고, 이
-- migration 이후 신규 RPC가 기록하는 행에만 activity/business date 규칙이 적용된다.

BEGIN;

ALTER TABLE public.child_mission_event_completions
  ADD COLUMN IF NOT EXISTS activity_type text,
  ADD COLUMN IF NOT EXISTS business_date date,
  ADD COLUMN IF NOT EXISTS source_session_id uuid;

ALTER TABLE public.child_mission_event_completions
  ALTER COLUMN mission_session_id DROP NOT NULL;

-- claude-review 지적: 레거시 (event_id, mission_session_id) UNIQUE가 신규
-- (event_id, child_id, activity_type, business_date) UNIQUE와 별개로 남아 있으면
-- ON CONFLICT가 지정한 제약이 아닌 레거시 제약에서 예기치 못한 unique_violation이
-- 날 수 있다. 신규 제약이 의미를 완전히 대체하므로 제거한다.
ALTER TABLE public.child_mission_event_completions
  DROP CONSTRAINT IF EXISTS child_mission_event_completions_session_unique,
  DROP CONSTRAINT IF EXISTS child_mission_event_completions_activity_type_check,
  DROP CONSTRAINT IF EXISTS child_mission_event_completions_source_session_fk,
  DROP CONSTRAINT IF EXISTS child_mission_event_completions_daily_activity_unique;

ALTER TABLE public.child_mission_event_completions
  ADD CONSTRAINT child_mission_event_completions_activity_type_check
  CHECK (
    activity_type IS NULL
    OR activity_type IN ('mission_complete', 'freechat_daily_engagement')
  ),
  ADD CONSTRAINT child_mission_event_completions_source_session_fk
  FOREIGN KEY (source_session_id)
  REFERENCES public.chat_sessions(id)
  ON DELETE SET NULL,
  ADD CONSTRAINT child_mission_event_completions_daily_activity_unique
  UNIQUE (event_id, child_id, activity_type, business_date);

COMMENT ON COLUMN public.child_mission_event_completions.activity_type IS
  '089 이후 이벤트 활동 유형. 기존 행은 소급 분류하지 않아 NULL을 유지한다.';
COMMENT ON COLUMN public.child_mission_event_completions.business_date IS
  '활동 완료 시각을 Asia/Seoul로 환산한 날짜. 기존 행은 백필하지 않는다.';
COMMENT ON COLUMN public.child_mission_event_completions.source_session_id IS
  '활동 근거 chat_sessions.id. mission/freechat 공통 출처이며 기존 행은 NULL을 유지한다.';
COMMENT ON COLUMN public.child_mission_event_completions.mission_session_id IS
  '레거시 미션 전용 출처. 089 이후 공통 출처는 source_session_id이며 자유대화 행에서는 NULL이다.';

-- 자유대화 Gold Key도 미션 키와 섞지 않고 출처/날짜를 감사할 수 있게 확장한다.
ALTER TABLE public.gold_key_ledger
  ADD COLUMN IF NOT EXISTS source_session_id uuid,
  ADD COLUMN IF NOT EXISTS business_date date;

ALTER TABLE public.gold_key_ledger
  DROP CONSTRAINT IF EXISTS gold_key_ledger_source_session_fk,
  DROP CONSTRAINT IF EXISTS gold_key_ledger_reason_check,
  DROP CONSTRAINT IF EXISTS gold_key_ledger_freechat_source_check;

ALTER TABLE public.gold_key_ledger
  ADD CONSTRAINT gold_key_ledger_source_session_fk
  FOREIGN KEY (source_session_id)
  REFERENCES public.chat_sessions(id)
  ON DELETE SET NULL,
  ADD CONSTRAINT gold_key_ledger_reason_check
  CHECK (reason IN ('attendance', 'mission', 'admin_adjustment', 'quiz_refund', 'freechat')),
  ADD CONSTRAINT gold_key_ledger_freechat_source_check
  CHECK (
    reward_type IS DISTINCT FROM 'freechat_daily_engagement'
    OR (
      reason = 'freechat'
      AND business_date IS NOT NULL
    )
  );

DROP INDEX IF EXISTS public.gold_key_ledger_freechat_daily_reward_unique;
CREATE UNIQUE INDEX IF NOT EXISTS gold_key_ledger_freechat_daily_reward_unique
  ON public.gold_key_ledger (child_id, reward_type, business_date)
  WHERE reward_type = 'freechat_daily_engagement';

COMMENT ON COLUMN public.gold_key_ledger.source_session_id IS
  '미션 외 활동 보상의 근거 chat_sessions.id. 기존 행은 NULL을 유지한다.';
COMMENT ON COLUMN public.gold_key_ledger.business_date IS
  '일일 멱등 보상의 Asia/Seoul 날짜. 기존 행은 백필하지 않는다.';

-- activity-aware 권위 RPC. child advisory lock을 이벤트 행 lock보다 먼저 잡아
-- mission reward/freechat reward와의 lock 순서를 통일하고 교차 활동 동시 요청도 직렬화한다.
CREATE OR REPLACE FUNCTION public.record_mission_event_completion(
  p_child_id uuid,
  p_environment text,
  p_activity_type text,
  p_source_session_id uuid,
  p_activity_completed_at timestamptz
)
RETURNS public.child_mission_onboarding_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.child_mission_onboarding_events;
  v_source_session public.chat_sessions;
  v_inserted boolean := false;
  v_in_window boolean;
  v_business_date date;
  v_launch_cutoff_at constant timestamptz := '2026-08-04 00:00:00+09';
BEGIN
  IF p_environment NOT IN ('development', 'production') THEN
    RAISE EXCEPTION 'invalid environment: %', p_environment;
  END IF;
  IF p_activity_type NOT IN ('mission_complete', 'freechat_daily_engagement') THEN
    RAISE EXCEPTION 'invalid activity_type: %', p_activity_type;
  END IF;
  IF p_source_session_id IS NULL OR p_activity_completed_at IS NULL THEN
    RAISE EXCEPTION 'source session and completed_at are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  SELECT * INTO v_source_session
  FROM public.chat_sessions
  WHERE id = p_source_session_id;

  IF v_source_session.id IS NULL OR v_source_session.child_id <> p_child_id THEN
    RAISE EXCEPTION 'source session does not belong to child';
  END IF;
  IF p_activity_type = 'mission_complete' AND v_source_session.session_type <> 'mission' THEN
    RAISE EXCEPTION 'mission activity requires a mission session';
  END IF;
  IF p_activity_type = 'freechat_daily_engagement' AND v_source_session.session_type <> 'free_chat' THEN
    RAISE EXCEPTION 'freechat activity requires a free_chat session';
  END IF;

  -- 출시 기준 이전 활동은 이벤트/신규 원장 어느 쪽도 만들지 않는다.
  IF p_activity_completed_at < v_launch_cutoff_at THEN
    SELECT * INTO v_event
    FROM public.child_mission_onboarding_events
    WHERE environment = p_environment AND child_id = p_child_id;
    RETURN v_event;
  END IF;

  v_business_date := (p_activity_completed_at AT TIME ZONE 'Asia/Seoul')::date;

  INSERT INTO public.child_mission_onboarding_events (
    child_id, environment, started_at, ends_at
  ) VALUES (
    p_child_id, p_environment, p_activity_completed_at, p_activity_completed_at + interval '30 days'
  )
  ON CONFLICT (environment, child_id) DO NOTHING;

  SELECT * INTO v_event
  FROM public.child_mission_onboarding_events
  WHERE environment = p_environment AND child_id = p_child_id
  FOR UPDATE;

  v_in_window := p_activity_completed_at >= v_event.started_at
                 AND p_activity_completed_at < v_event.ends_at;

  INSERT INTO public.child_mission_event_completions (
    event_id,
    child_id,
    mission_session_id,
    mission_completed_at,
    activity_type,
    business_date,
    source_session_id,
    counted,
    excluded_reason
  ) VALUES (
    v_event.id,
    p_child_id,
    CASE WHEN p_activity_type = 'mission_complete' THEN p_source_session_id ELSE NULL END,
    p_activity_completed_at,
    p_activity_type,
    v_business_date,
    p_source_session_id,
    v_in_window AND v_event.status = 'active' AND v_event.mission_completed_count < 60,
    CASE
      WHEN v_event.status <> 'active' THEN 'event_already_' || v_event.status
      WHEN NOT v_in_window THEN 'outside_30day_window'
      WHEN v_event.mission_completed_count >= 60 THEN 'max_count_reached'
      ELSE NULL
    END
  )
  ON CONFLICT (event_id, child_id, activity_type, business_date) DO NOTHING
  RETURNING true INTO v_inserted;

  IF v_inserted
     AND v_in_window
     AND v_event.status = 'active'
     AND v_event.mission_completed_count < 60 THEN
    UPDATE public.child_mission_onboarding_events
    SET mission_completed_count = LEAST(mission_completed_count + 1, 60),
        current_reward_amount = public.mission_onboarding_reward_tier(
          LEAST(mission_completed_count + 1, 60)
        ),
        status = CASE
          WHEN mission_completed_count + 1 >= 60 THEN 'max_completed'
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_event.id
    RETURNING * INTO v_event;
  END IF;

  RETURN v_event;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_mission_event_completion(
  uuid, text, text, uuid, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mission_event_completion(
  uuid, text, text, uuid, timestamptz
) TO service_role;

-- 기존 배포 코드가 구 4-parameter RPC를 호출해도 일일 상한을 우회하지 못하도록
-- legacy signature를 mission_complete 위임 wrapper로 교체한다.
CREATE OR REPLACE FUNCTION public.record_mission_event_completion(
  p_child_id uuid,
  p_environment text,
  p_mission_session_id uuid,
  p_mission_completed_at timestamptz
)
RETURNS public.child_mission_onboarding_events
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT public.record_mission_event_completion(
    p_child_id,
    p_environment,
    'mission_complete',
    p_mission_session_id,
    p_mission_completed_at
  );
$$;

REVOKE EXECUTE ON FUNCTION public.record_mission_event_completion(
  uuid, text, uuid, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mission_event_completion(
  uuid, text, uuid, timestamptz
) TO service_role;

-- DB completion trigger도 activity-aware RPC를 직접 호출한다. 같은 migration을 물리적으로
-- 분리된 Dev/Production DB에 적용할 수 있도록 PostgREST request host를 우선 판별하고,
-- host context가 없는 DB 작업은 그 DB의 기존 이벤트 environment를 fallback으로 사용한다.
CREATE OR REPLACE FUNCTION public.trg_mission_progress_record_event_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_environment text;
  v_request_host text;
BEGIN
  IF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' THEN
    BEGIN
      v_request_host := COALESCE(
        current_setting('request.headers', true)::jsonb ->> 'host',
        ''
      );
    EXCEPTION WHEN OTHERS THEN
      v_request_host := '';
    END;

    v_environment := CASE
      WHEN v_request_host LIKE '%fetvnhhjicndmxvhrffk%' THEN 'production'
      WHEN v_request_host LIKE '%mkrsaaedxqrcrktapaus%' THEN 'development'
      ELSE NULL
    END;

    -- claude-review 지적: 기존 이벤트 행 기반 추측이나 'development' 기본값은
    -- 실사용자(Production) 활동을 잘못된 환경에 fail-open으로 기록할 위험이 있다.
    -- request host로 환경을 확정하지 못하면 이 트리거는 아무것도 하지 않는다 —
    -- 정상 경로(app/api/mission/answer/route.ts)는 이미 getAppEventEnvironment()로
    -- 확정된 환경을 명시해 같은 RPC를 직접 호출하므로(ON CONFLICT로 멱등), 이
    -- 트리거는 그 경로를 타지 않는 예외적 completion에 대한 보조 안전망일 뿐이다.
    IF v_environment IS NULL THEN
      RETURN NEW;
    END IF;

    PERFORM public.record_mission_event_completion(
      NEW.child_id,
      v_environment,
      'mission_complete',
      NEW.session_id,
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 자유대화 종료 + 적격성 + Gold Key + 이벤트 집계를 한 트랜잭션에서 처리한다.
CREATE OR REPLACE FUNCTION public.complete_freechat_daily_engagement(
  p_child_id uuid,
  p_environment text,
  p_source_session_id uuid,
  p_turn_count integer,
  p_completed_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  rewarded boolean,
  eligible boolean,
  reason text,
  meaningful_turn_count integer,
  distinct_meaningful_turn_count integer,
  duration_seconds integer,
  event_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.chat_sessions;
  v_business_date date;
  v_meaningful_count integer := 0;
  v_distinct_meaningful_count integer := 0;
  v_duration_seconds integer := 0;
  v_active_balance integer := 0;
  v_reward_inserted boolean := false;
  v_event public.child_mission_onboarding_events;
BEGIN
  IF p_environment NOT IN ('development', 'production') THEN
    RAISE EXCEPTION 'invalid environment: %', p_environment;
  END IF;
  IF p_source_session_id IS NULL OR p_completed_at IS NULL THEN
    RAISE EXCEPTION 'source session and completed_at are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  SELECT * INTO v_session
  FROM public.chat_sessions
  WHERE id = p_source_session_id
  FOR UPDATE;

  IF v_session.id IS NULL OR v_session.child_id <> p_child_id THEN
    RAISE EXCEPTION 'source session does not belong to child';
  END IF;
  IF v_session.session_type <> 'free_chat' THEN
    RAISE EXCEPTION 'freechat reward requires a free_chat session';
  END IF;

  v_business_date := (p_completed_at AT TIME ZONE 'Asia/Seoul')::date;
  v_duration_seconds := GREATEST(
    0,
    FLOOR(EXTRACT(epoch FROM (p_completed_at - v_session.started_at)))::integer
  );

  UPDATE public.chat_sessions
  SET ended_at = p_completed_at,
      turn_count = GREATEST(turn_count, GREATEST(COALESCE(p_turn_count, 0), 0))
  WHERE id = p_source_session_id;

  -- 의미 발화: 아이 메시지 중 정규화 후 2자 이상이며 순수 필러/동일문자 반복이
  -- 아닌 것. chat_messages에는 draft/finalized 구분이 없어(전 행이 확정 메시지)
  -- 별도 상태 필터가 필요 없다. distinct 3개 요구가 같은 문장 반복 reward
  -- farming을 차단한다.
  WITH normalized AS (
    SELECT regexp_replace(lower(trim(content)), '[^0-9a-z가-힣]+', '', 'g') AS text
    FROM public.chat_messages
    WHERE session_id = p_source_session_id
      AND role = 'child'
  ), meaningful AS (
    SELECT text
    FROM normalized
    WHERE char_length(text) >= 2
      AND text NOT IN (
        '어', '음', '네', '응', '아니', '어어', '음음', '그래', '몰라', '모르겠어',
        '없어', '그냥', '글쎄', '패스', 'ㅋㅋ', 'ㅎㅎ', '하하', '히히'
      )
      AND text !~ '^(.)(\1)+$'
  )
  SELECT count(*)::integer, count(DISTINCT text)::integer
  INTO v_meaningful_count, v_distinct_meaningful_count
  FROM meaningful;

  IF v_duration_seconds < 60 THEN
    RETURN QUERY SELECT false, false, 'session_too_short', v_meaningful_count,
      v_distinct_meaningful_count, v_duration_seconds, NULL::integer;
    RETURN;
  END IF;
  IF v_meaningful_count < 3 THEN
    RETURN QUERY SELECT false, false, 'insufficient_meaningful_turns', v_meaningful_count,
      v_distinct_meaningful_count, v_duration_seconds, NULL::integer;
    RETURN;
  END IF;
  IF v_distinct_meaningful_count < 3 THEN
    RETURN QUERY SELECT false, false, 'spam_or_repeated_utterances', v_meaningful_count,
      v_distinct_meaningful_count, v_duration_seconds, NULL::integer;
    RETURN;
  END IF;

  SELECT mission_completed_count INTO event_count
  FROM public.child_mission_onboarding_events
  WHERE environment = p_environment AND child_id = p_child_id;

  IF EXISTS (
    SELECT 1
    FROM public.gold_key_ledger
    WHERE child_id = p_child_id
      AND reward_type = 'freechat_daily_engagement'
      AND business_date = v_business_date
  ) THEN
    RETURN QUERY SELECT false, true, 'already_rewarded_today', v_meaningful_count,
      v_distinct_meaningful_count, v_duration_seconds, event_count;
    RETURN;
  END IF;

  -- 이벤트 활동을 먼저 기록하고 실제 counted=true를 확인한다. 이 뒤 Gold Key insert가
  -- 실패하면 같은 DB 트랜잭션이므로 이벤트 증가도 함께 rollback된다. 반대로 이벤트이
  -- 기간 밖/60회 도달로 미집계되면 Gold Key를 만들지 않아 부분 반영이 없다.
  -- claude-review 지적 반영: Gold Key 잔액 상한(22개)은 보상 지급 정책이지 30일
  -- 이벤트 참여 집계와는 별개다. 잔액이 가득 차 있어도 활동 자체는 정상 인정되어
  -- 이벤트 카운트가 올라가야 하므로, 잔액 검사를 이벤트 기록 "이후" Gold Key
  -- 지급 직전으로 옮긴다.
  v_event := public.record_mission_event_completion(
    p_child_id,
    p_environment,
    'freechat_daily_engagement',
    p_source_session_id,
    p_completed_at
  );

  IF v_event.id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.child_mission_event_completions
    WHERE event_id = v_event.id
      AND child_id = p_child_id
      AND activity_type = 'freechat_daily_engagement'
      AND business_date = v_business_date
      AND counted = true
  ) THEN
    RETURN QUERY SELECT false, true, 'event_not_counted', v_meaningful_count,
      v_distinct_meaningful_count, v_duration_seconds,
      CASE WHEN v_event.id IS NULL THEN NULL::integer ELSE v_event.mission_completed_count END;
    RETURN;
  END IF;

  -- 전역 활성 Gold Key 상한(22개)은 기존 정책을 그대로 지킨다 — 단, 이벤트 카운트는
  -- 위에서 이미 반영됐으므로 여기서는 Gold Key 지급만 건너뛴다(활동 인정은 유지).
  SELECT count(*)::integer INTO v_active_balance
  FROM public.gold_key_ledger
  WHERE child_id = p_child_id
    AND consumed = false
    AND expires_at > p_completed_at;

  IF v_active_balance >= 22 THEN
    RETURN QUERY SELECT false, true, 'active_balance_limit', v_meaningful_count,
      v_distinct_meaningful_count, v_duration_seconds, v_event.mission_completed_count;
    RETURN;
  END IF;

  INSERT INTO public.gold_key_ledger (
    child_id,
    reason,
    expires_at,
    reward_type,
    source_session_id,
    business_date
  ) VALUES (
    p_child_id,
    'freechat',
    p_completed_at + interval '7 days',
    'freechat_daily_engagement',
    p_source_session_id,
    v_business_date
  )
  ON CONFLICT (child_id, reward_type, business_date)
    WHERE reward_type = 'freechat_daily_engagement'
  DO NOTHING
  RETURNING true INTO v_reward_inserted;

  IF NOT v_reward_inserted THEN
    RETURN QUERY SELECT false, true, 'already_rewarded_today', v_meaningful_count,
      v_distinct_meaningful_count, v_duration_seconds, v_event.mission_completed_count;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, true, 'rewarded', v_meaningful_count,
    v_distinct_meaningful_count, v_duration_seconds, v_event.mission_completed_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_freechat_daily_engagement(
  uuid, text, uuid, integer, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_freechat_daily_engagement(
  uuid, text, uuid, integer, timestamptz
) TO service_role;

COMMIT;
