-- requests/request_daily_attendance_golden_key_roulette_event.md
-- KST 논리 날짜 기반 출석 룰렛. spin/재시도/one-shot/황금열쇠 지급을 한 트랜잭션으로 처리한다.

CREATE TABLE public.attendance_roulette_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  base_spin_used boolean NOT NULL DEFAULT false,
  retry_credits_granted integer NOT NULL DEFAULT 0 CHECK (retry_credits_granted >= 0),
  retry_credits_used integer NOT NULL DEFAULT 0 CHECK (retry_credits_used >= 0 AND retry_credits_used <= retry_credits_granted),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (child_id, attendance_date)
);

CREATE TABLE public.attendance_roulette_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  result_code text NOT NULL CHECK (result_code IN ('LOSE', 'RETRY', 'KEY_1', 'KEY_3', 'KEY_5', 'KEY_7', 'KEY_9')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONSUMED', 'CANCELLED')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  consumed_spin_id uuid,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by_email text,
  admin_note text CHECK (char_length(admin_note) <= 500)
);

CREATE UNIQUE INDEX attendance_roulette_one_pending_override
  ON public.attendance_roulette_overrides(child_id)
  WHERE status = 'PENDING';

CREATE TABLE public.attendance_roulette_spins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES public.attendance_roulette_days(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  spin_sequence integer NOT NULL CHECK (spin_sequence > 0),
  source text NOT NULL CHECK (source IN ('BASE', 'RETRY')),
  result_code text NOT NULL CHECK (result_code IN ('LOSE', 'RETRY', 'KEY_1', 'KEY_3', 'KEY_5', 'KEY_7', 'KEY_9')),
  key_reward integer NOT NULL DEFAULT 0 CHECK (key_reward IN (0, 1, 3, 5, 7, 9)),
  used_manual_override boolean NOT NULL DEFAULT false,
  manual_override_id uuid REFERENCES public.attendance_roulette_overrides(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (child_id, attendance_date, spin_sequence),
  UNIQUE (idempotency_key)
);

ALTER TABLE public.attendance_roulette_overrides
  ADD CONSTRAINT attendance_roulette_override_consumed_spin_fk
  FOREIGN KEY (consumed_spin_id) REFERENCES public.attendance_roulette_spins(id) ON DELETE SET NULL;

CREATE INDEX attendance_roulette_spins_child_date
  ON public.attendance_roulette_spins(child_id, attendance_date DESC, spin_sequence DESC);
CREATE INDEX attendance_roulette_spins_result_date
  ON public.attendance_roulette_spins(attendance_date, result_code);
CREATE INDEX attendance_roulette_overrides_history
  ON public.attendance_roulette_overrides(child_id, created_at DESC);

CREATE TABLE public.attendance_roulette_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('OVERRIDE_CREATE', 'OVERRIDE_UPDATE', 'OVERRIDE_CANCEL', 'OVERRIDE_CONSUME', 'SPIN_SETTLE', 'SPIN_REPLAY', 'SPIN_REJECT')),
  child_id uuid NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  spin_id uuid REFERENCES public.attendance_roulette_spins(id) ON DELETE SET NULL,
  override_id uuid REFERENCES public.attendance_roulette_overrides(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attendance_roulette_audit_created
  ON public.attendance_roulette_audit_log(created_at DESC);
CREATE INDEX attendance_roulette_audit_child
  ON public.attendance_roulette_audit_log(child_id, created_at DESC);

-- 기존 단위-row 황금열쇠 원장을 그대로 사용하되 룰렛 spin과 지급 순번을 명시적으로 연결한다.
ALTER TABLE public.gold_key_ledger
  ADD COLUMN IF NOT EXISTS attendance_roulette_spin_id uuid,
  ADD COLUMN IF NOT EXISTS reward_sequence smallint;

ALTER TABLE public.gold_key_ledger
  ADD CONSTRAINT gold_key_ledger_attendance_roulette_spin_fk
  FOREIGN KEY (attendance_roulette_spin_id) REFERENCES public.attendance_roulette_spins(id) ON DELETE SET NULL;

ALTER TABLE public.gold_key_ledger
  ADD CONSTRAINT gold_key_ledger_reward_sequence_check
  CHECK (reward_sequence IS NULL OR reward_sequence > 0);

CREATE UNIQUE INDEX gold_key_ledger_attendance_roulette_reward
  ON public.gold_key_ledger(attendance_roulette_spin_id, reward_sequence)
  WHERE attendance_roulette_spin_id IS NOT NULL;

-- 관리자 표의 "최근 결과"는 오늘 참여 여부와 별개로 아이별 마지막 확정 spin을 반환한다.
CREATE OR REPLACE FUNCTION public.get_attendance_roulette_latest_spins()
RETURNS TABLE (
  id uuid,
  child_id uuid,
  attendance_date date,
  result_code text,
  key_reward integer,
  source text,
  used_manual_override boolean,
  settled_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (s.child_id)
    s.id, s.child_id, s.attendance_date, s.result_code, s.key_reward,
    s.source, s.used_manual_override, s.settled_at
  FROM public.attendance_roulette_spins s
  ORDER BY s.child_id, s.attendance_date DESC, s.spin_sequence DESC;
$$;

ALTER TABLE public.attendance_roulette_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_roulette_spins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_roulette_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_roulette_audit_log ENABLE ROW LEVEL SECURITY;

-- 모든 앱 접근은 인증/권한 검사를 수행하는 서버 API(service_role)를 통한다.
REVOKE ALL ON public.attendance_roulette_days FROM anon, authenticated;
REVOKE ALL ON public.attendance_roulette_spins FROM anon, authenticated;
REVOKE ALL ON public.attendance_roulette_overrides FROM anon, authenticated;
REVOKE ALL ON public.attendance_roulette_audit_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_roulette_days TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_roulette_spins TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_roulette_overrides TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_roulette_audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.attendance_roulette_audit_log_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.spin_attendance_roulette(
  p_child_id uuid,
  p_idempotency_key text,
  p_test_result text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_day public.attendance_roulette_days%ROWTYPE;
  v_existing public.attendance_roulette_spins%ROWTYPE;
  v_override public.attendance_roulette_overrides%ROWTYPE;
  v_spin_id uuid := gen_random_uuid();
  v_sequence integer;
  v_source text;
  v_result text;
  v_reward integer := 0;
  v_is_test boolean := false;
  v_retry_remaining integer;
  v_can_spin boolean;
BEGIN
  IF p_child_id IS NULL OR p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_child_id::text, 7319));

  SELECT * INTO v_existing
  FROM public.attendance_roulette_spins
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.child_id <> p_child_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
    END IF;
    SELECT * INTO v_day FROM public.attendance_roulette_days WHERE id = v_existing.day_id;
    v_retry_remaining := v_day.retry_credits_granted - v_day.retry_credits_used;
    v_can_spin := (NOT v_day.base_spin_used) OR v_retry_remaining > 0;
    INSERT INTO public.attendance_roulette_audit_log(action, child_id, spin_id, override_id, after_state)
    VALUES ('SPIN_REPLAY', p_child_id, v_existing.id, v_existing.manual_override_id,
      jsonb_build_object('idempotencyKeyReused', true, 'resultCode', v_existing.result_code));
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true, 'spinId', v_existing.id,
      'attendanceDate', v_existing.attendance_date, 'source', v_existing.source,
      'resultCode', v_existing.result_code, 'keyReward', v_existing.key_reward,
      'retryCreditsRemaining', v_retry_remaining, 'canSpin', v_can_spin,
      'settledAt', v_existing.settled_at
    );
  END IF;

  SELECT COALESCE(is_test_account, false) OR COALESCE(is_internal_test, false)
    INTO v_is_test
  FROM public.child_profiles
  WHERE id = p_child_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'child_not_found');
  END IF;

  IF p_test_result IS NOT NULL THEN
    IF NOT v_is_test THEN
      RETURN jsonb_build_object('ok', false, 'error', 'test_result_not_allowed');
    END IF;
    IF p_test_result NOT IN ('LOSE', 'RETRY', 'KEY_1', 'KEY_3', 'KEY_5', 'KEY_7', 'KEY_9') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_test_result');
    END IF;
  END IF;

  INSERT INTO public.attendance_roulette_days(child_id, attendance_date)
  VALUES (p_child_id, v_date)
  ON CONFLICT (child_id, attendance_date) DO NOTHING;

  SELECT * INTO v_day
  FROM public.attendance_roulette_days
  WHERE child_id = p_child_id AND attendance_date = v_date
  FOR UPDATE;

  IF NOT v_day.base_spin_used THEN
    v_source := 'BASE';
    UPDATE public.attendance_roulette_days
    SET base_spin_used = true, updated_at = now()
    WHERE id = v_day.id;
    v_day.base_spin_used := true;
  ELSIF v_day.retry_credits_granted > v_day.retry_credits_used THEN
    v_source := 'RETRY';
    UPDATE public.attendance_roulette_days
    SET retry_credits_used = retry_credits_used + 1, updated_at = now()
    WHERE id = v_day.id
    RETURNING * INTO v_day;
  ELSE
    SELECT * INTO v_existing
    FROM public.attendance_roulette_spins
    WHERE child_id = p_child_id AND attendance_date = v_date
    ORDER BY spin_sequence DESC LIMIT 1;
    INSERT INTO public.attendance_roulette_audit_log(action, child_id, spin_id, after_state)
    VALUES ('SPIN_REJECT', p_child_id, v_existing.id,
      jsonb_build_object('error', 'no_available_spin', 'attendanceDate', v_date));
    RETURN jsonb_build_object(
      'ok', false, 'error', 'no_available_spin', 'attendanceDate', v_date,
      'lastSpinId', v_existing.id, 'lastResultCode', v_existing.result_code,
      'lastKeyReward', v_existing.key_reward
    );
  END IF;

  SELECT * INTO v_override
  FROM public.attendance_roulette_overrides
  WHERE child_id = p_child_id AND status = 'PENDING'
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_result := v_override.result_code;
  ELSIF p_test_result IS NOT NULL THEN
    v_result := p_test_result;
  ELSIF random() < 0.80 THEN
    v_result := 'KEY_1';
  ELSE
    v_result := 'RETRY';
  END IF;

  v_reward := CASE v_result
    WHEN 'KEY_1' THEN 1 WHEN 'KEY_3' THEN 3 WHEN 'KEY_5' THEN 5
    WHEN 'KEY_7' THEN 7 WHEN 'KEY_9' THEN 9 ELSE 0 END;

  SELECT COALESCE(max(spin_sequence), 0) + 1 INTO v_sequence
  FROM public.attendance_roulette_spins WHERE day_id = v_day.id;

  INSERT INTO public.attendance_roulette_spins(
    id, day_id, child_id, attendance_date, spin_sequence, source, result_code,
    key_reward, used_manual_override, manual_override_id, idempotency_key
  ) VALUES (
    v_spin_id, v_day.id, p_child_id, v_date, v_sequence, v_source, v_result,
    v_reward, v_override.id IS NOT NULL, v_override.id, p_idempotency_key
  );

  IF v_reward > 0 THEN
    INSERT INTO public.gold_key_ledger(
      child_id, reason, reward_type, expires_at, attendance_roulette_spin_id, reward_sequence
    )
    SELECT p_child_id, 'attendance', 'attendance_roulette', now() + interval '7 days', v_spin_id, n
    FROM generate_series(1, v_reward) AS n;
  ELSIF v_result = 'RETRY' THEN
    UPDATE public.attendance_roulette_days
    SET retry_credits_granted = retry_credits_granted + 1, updated_at = now()
    WHERE id = v_day.id
    RETURNING * INTO v_day;
  END IF;

  IF v_override.id IS NOT NULL THEN
    UPDATE public.attendance_roulette_overrides
    SET status = 'CONSUMED', consumed_at = now(), consumed_spin_id = v_spin_id, updated_at = now()
    WHERE id = v_override.id AND status = 'PENDING';
    INSERT INTO public.attendance_roulette_audit_log(action, child_id, spin_id, override_id, actor_user_id, actor_email, before_state, after_state)
    VALUES ('OVERRIDE_CONSUME', p_child_id, v_spin_id, v_override.id, v_override.created_by, v_override.created_by_email,
      jsonb_build_object('status', 'PENDING', 'resultCode', v_override.result_code),
      jsonb_build_object('status', 'CONSUMED', 'resultCode', v_result));
  END IF;

  INSERT INTO public.attendance_roulette_audit_log(action, child_id, spin_id, override_id, after_state)
  VALUES ('SPIN_SETTLE', p_child_id, v_spin_id, v_override.id,
    jsonb_build_object('attendanceDate', v_date, 'source', v_source, 'resultCode', v_result, 'keyReward', v_reward));

  SELECT * INTO v_day FROM public.attendance_roulette_days WHERE id = v_day.id;
  v_retry_remaining := v_day.retry_credits_granted - v_day.retry_credits_used;
  v_can_spin := (NOT v_day.base_spin_used) OR v_retry_remaining > 0;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'spinId', v_spin_id,
    'attendanceDate', v_date, 'source', v_source, 'resultCode', v_result,
    'keyReward', v_reward, 'retryCreditsRemaining', v_retry_remaining,
    'canSpin', v_can_spin, 'settledAt', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_attendance_roulette_override(
  p_child_id uuid,
  p_result_code text,
  p_admin_id uuid,
  p_admin_email text,
  p_admin_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.attendance_roulette_overrides%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_admin_id IS NULL OR p_admin_email IS NULL OR btrim(p_admin_email) = '' THEN
    RAISE EXCEPTION 'invalid_admin_actor';
  END IF;
  IF p_result_code NOT IN ('LOSE', 'RETRY', 'KEY_1', 'KEY_3', 'KEY_5', 'KEY_7', 'KEY_9') THEN
    RAISE EXCEPTION 'invalid_result_code';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.child_profiles WHERE id = p_child_id) THEN
    RAISE EXCEPTION 'child_not_found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_child_id::text, 7319));
  SELECT * INTO v_existing FROM public.attendance_roulette_overrides
  WHERE child_id = p_child_id AND status = 'PENDING' FOR UPDATE;

  IF FOUND THEN
    UPDATE public.attendance_roulette_overrides
    SET result_code = p_result_code, admin_note = p_admin_note, created_by = p_admin_id,
        created_by_email = p_admin_email, updated_at = now()
    WHERE id = v_existing.id RETURNING id INTO v_id;
    INSERT INTO public.attendance_roulette_audit_log(action, child_id, override_id, actor_user_id, actor_email, before_state, after_state)
    VALUES ('OVERRIDE_UPDATE', p_child_id, v_id, p_admin_id, p_admin_email,
      jsonb_build_object('resultCode', v_existing.result_code, 'note', v_existing.admin_note),
      jsonb_build_object('resultCode', p_result_code, 'note', p_admin_note));
  ELSE
    INSERT INTO public.attendance_roulette_overrides(child_id, result_code, created_by, created_by_email, admin_note)
    VALUES (p_child_id, p_result_code, p_admin_id, p_admin_email, p_admin_note) RETURNING id INTO v_id;
    INSERT INTO public.attendance_roulette_audit_log(action, child_id, override_id, actor_user_id, actor_email, after_state)
    VALUES ('OVERRIDE_CREATE', p_child_id, v_id, p_admin_id, p_admin_email,
      jsonb_build_object('status', 'PENDING', 'resultCode', p_result_code, 'note', p_admin_note));
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_attendance_roulette_override(
  p_child_id uuid,
  p_admin_id uuid,
  p_admin_email text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.attendance_roulette_overrides%ROWTYPE;
BEGIN
  IF p_admin_id IS NULL OR p_admin_email IS NULL OR btrim(p_admin_email) = '' THEN
    RAISE EXCEPTION 'invalid_admin_actor';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_child_id::text, 7319));
  SELECT * INTO v_existing FROM public.attendance_roulette_overrides
  WHERE child_id = p_child_id AND status = 'PENDING' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.attendance_roulette_overrides
  SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_admin_id,
      cancelled_by_email = p_admin_email, updated_at = now()
  WHERE id = v_existing.id AND status = 'PENDING';
  INSERT INTO public.attendance_roulette_audit_log(action, child_id, override_id, actor_user_id, actor_email, before_state, after_state)
  VALUES ('OVERRIDE_CANCEL', p_child_id, v_existing.id, p_admin_id, p_admin_email,
    jsonb_build_object('status', 'PENDING', 'resultCode', v_existing.result_code),
    jsonb_build_object('status', 'CANCELLED', 'resultCode', v_existing.result_code));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.spin_attendance_roulette(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_attendance_roulette_latest_spins() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_attendance_roulette_override(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_attendance_roulette_override(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spin_attendance_roulette(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_attendance_roulette_latest_spins() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_attendance_roulette_override(uuid, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_attendance_roulette_override(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.spin_attendance_roulette(uuid, text, text) IS
  'KST 일일 출석 룰렛 원자 처리. p_test_result는 test/internal 계정의 서버 직접 QA 전용이며 사용자 API는 전달하지 않는다.';
