CREATE TABLE IF NOT EXISTS public.account_lifecycle_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES public.parents(id),
  event_type text NOT NULL CHECK (event_type IN ('unsubscribe_requested', 'grace_period_started', 'restore_requested', 'deletion_warning_7d', 'deletion_warning_1d', 'deleted')),
  channel text NOT NULL CHECK (channel IN ('email', 'push')),
  sent_at timestamptz DEFAULT now(),
  status text NOT NULL,
  error_message text
);
GRANT ALL ON public.account_lifecycle_notifications TO anon, authenticated;
ALTER TABLE public.account_lifecycle_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable ALL for service_role"
  ON public.account_lifecycle_notifications
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
