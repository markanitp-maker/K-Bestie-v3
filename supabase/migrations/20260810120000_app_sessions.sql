-- 087 Phase 1: authenticated parent/child app session analytics.
-- Forward-only: no historical visit or duration backfill is attempted.

BEGIN;

-- behavior_events remains the source for discrete lifecycle events. Extend only
-- the existing feature allow-list so app_session events can be recorded.
ALTER TABLE public.behavior_events
  DROP CONSTRAINT IF EXISTS behavior_events_feature_check;

ALTER TABLE public.behavior_events
  ADD CONSTRAINT behavior_events_feature_check CHECK (feature IN (
    'auth', 'home', 'mission', 'freechat', 'play', 'daily_report',
    'weekly_report', 'monthly_report', 'conversation_topic',
    'child_management', 'guardian_settings', 'subscription', 'app_session'
  ));

CREATE TABLE IF NOT EXISTS public.app_sessions (
  session_id uuid PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('parent', 'child')),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  child_id uuid REFERENCES public.child_profiles(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  foreground_duration_sec integer NOT NULL DEFAULT 0
    CHECK (foreground_duration_sec >= 0),
  route_at_start text NOT NULL CHECK (
    char_length(route_at_start) BETWEEN 1 AND 512
    AND route_at_start LIKE '/%'
    AND route_at_start !~ '[[:cntrl:]?#]'
  ),
  environment text NOT NULL CHECK (environment IN ('dev', 'prod')),
  CHECK (
    (actor_type = 'child' AND child_id IS NOT NULL)
    OR (actor_type = 'parent' AND child_id IS NULL)
  ),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS app_sessions_actor_started_at_idx
  ON public.app_sessions (actor_type, actor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS app_sessions_family_started_at_idx
  ON public.app_sessions (family_id, started_at DESC);
CREATE INDEX IF NOT EXISTS app_sessions_open_heartbeat_idx
  ON public.app_sessions (last_heartbeat_at)
  WHERE ended_at IS NULL;

COMMENT ON TABLE public.app_sessions IS
  '인증된 부모/아이의 앱 세션과 foreground heartbeat 누적값. 대화·음성·리포트·페이지 본문은 저장하지 않음.';
COMMENT ON COLUMN public.app_sessions.route_at_start IS
  '세션 시작 시 URL pathname만 저장. query/hash/page content는 금지.';

-- behavior_events와 같은 service_role 전용 RLS 패턴. anon/authenticated에는
-- 프로젝트 규약상 table grant를 부여하되, 허용 RLS 정책이 없어 행 접근은 차단된다.
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON public.app_sessions;
CREATE POLICY "service_role_all"
  ON public.app_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.app_sessions TO anon, authenticated;
GRANT ALL ON public.app_sessions TO service_role;

-- A single atomic update prevents concurrent heartbeat/background requests from
-- overwriting accumulated duration. Gaps over 60 seconds are capped so a suspended
-- tab or offline device is not counted as foreground time.
CREATE OR REPLACE FUNCTION public.record_app_session_action(
  p_session_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_action text
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_updated_count integer;
BEGIN
  IF p_action NOT IN ('heartbeat', 'foreground', 'background', 'end') THEN
    RAISE EXCEPTION 'invalid app session action';
  END IF;

  UPDATE public.app_sessions
  SET
    foreground_duration_sec = foreground_duration_sec +
      CASE
        WHEN p_action IN ('heartbeat', 'background') THEN LEAST(
          60,
          GREATEST(
            0,
            floor(extract(epoch FROM (v_now - last_heartbeat_at)))::integer
          )
        )
        ELSE 0
      END,
    last_heartbeat_at = CASE
      WHEN p_action IN ('heartbeat', 'foreground', 'background') THEN v_now
      ELSE last_heartbeat_at
    END,
    ended_at = CASE WHEN p_action = 'end' THEN v_now ELSE ended_at END
  WHERE session_id = p_session_id
    AND actor_type = p_actor_type
    AND actor_id = p_actor_id
    AND ended_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.record_app_session_action(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_app_session_action(uuid, text, uuid, text)
  TO service_role;

COMMIT;
