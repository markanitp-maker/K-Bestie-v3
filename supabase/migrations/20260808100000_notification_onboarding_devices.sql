-- Request-alert: 역할·아이·기기별 Push 구독과 알림 온보딩 상태.
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS child_id uuid REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS installation_id text,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS browser text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS permission_status text DEFAULT 'granted',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

UPDATE public.push_subscriptions ps
SET role = CASE WHEN EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.user_id = ps.user_id AND fm.role = 'child' AND fm.deleted_at IS NULL
    ) THEN 'child' ELSE 'parent' END,
    installation_id = COALESCE(ps.installation_id, 'legacy:' || ps.id::text),
    device_id = COALESCE(ps.device_id, 'legacy:' || ps.id::text),
    permission_status = COALESCE(ps.permission_status, 'granted'),
    last_seen_at = COALESCE(ps.last_seen_at, ps.updated_at, ps.created_at, now())
WHERE role IS NULL OR installation_id IS NULL OR device_id IS NULL;

UPDATE public.push_subscriptions ps
SET child_id = cp.id
FROM public.family_members fm
JOIN public.child_profiles cp ON cp.member_id = fm.id
WHERE ps.user_id = fm.user_id AND ps.role = 'child' AND ps.child_id IS NULL
  AND fm.role = 'child' AND fm.deleted_at IS NULL;

-- A legacy child subscription without a live child profile cannot be scoped safely.
DELETE FROM public.push_subscriptions
WHERE role = 'child' AND child_id IS NULL;

ALTER TABLE public.push_subscriptions ALTER COLUMN role SET NOT NULL;
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_role_check,
  ADD CONSTRAINT push_subscriptions_role_check CHECK (role IN ('parent','child')),
  DROP CONSTRAINT IF EXISTS push_subscriptions_permission_status_check,
  ADD CONSTRAINT push_subscriptions_permission_status_check CHECK (permission_status IN ('default','granted','denied')),
  DROP CONSTRAINT IF EXISTS push_subscriptions_child_scope_check,
  ADD CONSTRAINT push_subscriptions_child_scope_check CHECK (
    (role = 'parent' AND child_id IS NULL) OR (role = 'child' AND child_id IS NOT NULL)
  ) NOT VALID;
ALTER TABLE public.push_subscriptions VALIDATE CONSTRAINT push_subscriptions_child_scope_check;

-- 같은 endpoint/설치가 여러 계정에 남은 기존 행은 최신 1개만 활성화한다.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY endpoint ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC) AS rn
  FROM public.push_subscriptions WHERE is_active
)
UPDATE public.push_subscriptions ps
SET is_active = false, revoked_at = COALESCE(revoked_at, now())
FROM ranked r WHERE ps.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_one_active_endpoint
  ON public.push_subscriptions(endpoint) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_one_active_installation
  ON public.push_subscriptions(installation_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS push_subscriptions_delivery_scope
  ON public.push_subscriptions(role, child_id, user_id) WHERE is_active AND permission_status = 'granted';

DROP POLICY IF EXISTS push_subscriptions_insert ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_delete ON public.push_subscriptions;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  child_id uuid REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('parent','child')),
  scope_key text NOT NULL,
  parent_report_enabled boolean NOT NULL DEFAULT true,
  mission_start_enabled boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Seoul',
  parent_report_time time NOT NULL DEFAULT '07:00:00',
  onboarding_version integer NOT NULL DEFAULT 0,
  onboarding_completed_at timestamptz,
  last_prompted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role, scope_key),
  CONSTRAINT notification_preferences_scope_check CHECK (
    (role = 'parent' AND child_id IS NULL AND scope_key = 'parent') OR
    (role = 'child' AND child_id IS NOT NULL AND scope_key = child_id::text)
  )
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_preferences FROM anon, authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

ALTER TABLE public.report_notification_logs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.report_notification_logs
  DROP CONSTRAINT IF EXISTS report_notification_logs_status_check,
  ADD CONSTRAINT report_notification_logs_status_check CHECK (status IN ('pending','sent','failed'));

ALTER TABLE public.mission_notification_logs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.mission_notification_logs
  DROP CONSTRAINT IF EXISTS mission_notification_logs_status_check,
  ADD CONSTRAINT mission_notification_logs_status_check CHECK (status IN ('pending','sent','failed'));

CREATE OR REPLACE FUNCTION public.register_push_subscription_v1(
  p_user_id uuid,
  p_child_id uuid,
  p_role text,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_device_id text,
  p_installation_id text,
  p_platform text,
  p_browser text,
  p_user_agent text,
  p_onboarding_version integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_role NOT IN ('parent','child') OR p_endpoint IS NULL OR p_installation_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_SCOPE';
  END IF;
  IF (p_role = 'parent' AND p_child_id IS NOT NULL) OR (p_role = 'child' AND p_child_id IS NULL) THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_SCOPE';
  END IF;

  UPDATE public.push_subscriptions
  SET is_active=false, revoked_at=now(), updated_at=now()
  WHERE is_active AND (endpoint=p_endpoint OR installation_id=p_installation_id);

  INSERT INTO public.push_subscriptions (
    user_id,child_id,role,endpoint,p256dh,auth,device_id,installation_id,
    platform,browser,user_agent,permission_status,is_active,last_seen_at,revoked_at,updated_at
  ) VALUES (
    p_user_id,p_child_id,p_role,p_endpoint,p_p256dh,p_auth,p_device_id,p_installation_id,
    p_platform,p_browser,left(p_user_agent,500),'granted',true,now(),null,now()
  )
  ON CONFLICT (user_id,endpoint) DO UPDATE SET
    child_id=excluded.child_id, role=excluded.role, p256dh=excluded.p256dh, auth=excluded.auth,
    device_id=excluded.device_id, installation_id=excluded.installation_id,
    platform=excluded.platform, browser=excluded.browser, user_agent=excluded.user_agent,
    permission_status='granted', is_active=true, last_seen_at=now(), revoked_at=null, updated_at=now()
  RETURNING id INTO v_id;

  INSERT INTO public.notification_preferences (
    user_id,child_id,role,scope_key,parent_report_enabled,mission_start_enabled,
    onboarding_version,onboarding_completed_at,last_prompted_at,updated_at
  ) VALUES (
    p_user_id,p_child_id,p_role,CASE WHEN p_role='parent' THEN 'parent' ELSE p_child_id::text END,
    true,true,p_onboarding_version,now(),now(),now()
  ) ON CONFLICT (user_id,role,scope_key) DO UPDATE SET
    child_id=excluded.child_id,
    parent_report_enabled=CASE WHEN p_role='parent' THEN true ELSE notification_preferences.parent_report_enabled END,
    mission_start_enabled=CASE WHEN p_role='child' THEN true ELSE notification_preferences.mission_start_enabled END,
    onboarding_version=greatest(notification_preferences.onboarding_version,excluded.onboarding_version),
    onboarding_completed_at=now(),last_prompted_at=now(),updated_at=now();
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_push_subscription_v1(uuid,uuid,text,text,text,text,text,text,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_subscription_v1(uuid,uuid,text,text,text,text,text,text,text,text,text,integer) TO service_role;
