ALTER TABLE public.account_lifecycle_notifications
ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
ADD COLUMN IF NOT EXISTS template_key text;

GRANT ALL ON public.account_lifecycle_notifications TO anon, authenticated;
