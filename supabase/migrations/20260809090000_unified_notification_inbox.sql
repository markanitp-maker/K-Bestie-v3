-- Request 026: 부모·아이·Push·PWA가 공유하는 서버 알림 원장.
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  child_id uuid REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('parent', 'child')),
  type text NOT NULL CHECK (type IN ('event', 'mission', 'report', 'reward', 'system')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL DEFAULT '',
  target_url text NOT NULL DEFAULT '/',
  source_id text,
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT notifications_child_scope_check CHECK (role <> 'child' OR child_id IS NOT NULL),
  CONSTRAINT notifications_internal_target_check CHECK (target_url = '/' OR target_url ~ '^/[^/]')
);

CREATE INDEX IF NOT EXISTS notifications_user_timeline
  ON public.notifications(user_id, role, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread
  ON public.notifications(user_id, role, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_child_timeline
  ON public.notifications(child_id, created_at DESC)
  WHERE child_id IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.notification_scope_matches_user_v1(
  p_actor_id uuid,
  p_recipient_id uuid,
  p_role text,
  p_child_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_actor_id IS NOT NULL
    AND p_actor_id = auth.uid()
    AND p_recipient_id = p_actor_id
    AND (
      (p_role = 'parent' AND EXISTS (
        SELECT 1
        FROM public.family_members fm
        WHERE fm.user_id = p_actor_id
          AND fm.role IN ('parent', 'owner_parent')
          AND fm.deleted_at IS NULL
          AND (p_child_id IS NULL OR EXISTS (
            SELECT 1 FROM public.child_profiles cp
            WHERE cp.id = p_child_id AND cp.family_id = fm.family_id
          ))
      ))
      OR
      (p_role = 'child' AND EXISTS (
        SELECT 1
        FROM public.child_profiles cp
        JOIN public.family_members fm ON fm.id = cp.member_id
        WHERE cp.id = p_child_id
          AND fm.user_id = p_actor_id
          AND fm.role = 'child'
          AND fm.deleted_at IS NULL
      ))
    );
$$;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (public.notification_scope_matches_user_v1(auth.uid(), user_id, role, child_id));

-- 클라이언트는 행을 직접 변경하지 않는다. 읽음 전이는 아래 RPC만 허용한다.
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

CREATE OR REPLACE FUNCTION public.mark_notification_read_v1(p_notification_id uuid)
RETURNS TABLE(notification_id uuid, read_at timestamptz, unread_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_read_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  UPDATE public.notifications n
  SET read_at = COALESCE(n.read_at, now())
  WHERE n.id = p_notification_id
    AND public.notification_scope_matches_user_v1(v_user_id, n.user_id, n.role, n.child_id)
  RETURNING n.read_at INTO v_read_at;

  IF v_read_at IS NULL THEN RAISE EXCEPTION 'NOTIFICATION_NOT_FOUND'; END IF;

  RETURN QUERY SELECT p_notification_id, v_read_at, count(*)
  FROM public.notifications n
  WHERE n.user_id = v_user_id
    AND n.read_at IS NULL
    AND (n.expires_at IS NULL OR n.expires_at > now())
    AND public.notification_scope_matches_user_v1(v_user_id, n.user_id, n.role, n.child_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read_v1()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.notifications
  SET read_at = COALESCE(read_at, now())
  WHERE user_id = v_user_id
    AND read_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND public.notification_scope_matches_user_v1(v_user_id, user_id, role, child_id);
  SELECT count(*) INTO v_count
  FROM public.notifications
  WHERE user_id = v_user_id
    AND read_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND public.notification_scope_matches_user_v1(v_user_id, user_id, role, child_id);
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_read_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_scope_matches_user_v1(uuid,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_scope_matches_user_v1(uuid,uuid,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_read_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read_v1() TO service_role;
