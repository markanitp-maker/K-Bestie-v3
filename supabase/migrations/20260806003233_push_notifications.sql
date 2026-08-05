-- 1. Push Subscriptions Table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_insert ON public.push_subscriptions
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY push_subscriptions_select ON public.push_subscriptions
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY push_subscriptions_delete ON public.push_subscriptions
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 2. Report Notification Logs Table
CREATE TABLE IF NOT EXISTS public.report_notification_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    parent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    notification_type text NOT NULL,
    notification_date date NOT NULL,
    report_type text NOT NULL,
    sent_at timestamptz DEFAULT now(),
    UNIQUE(parent_id, notification_date, notification_type, report_type)
);

ALTER TABLE public.report_notification_logs ENABLE ROW LEVEL SECURITY;

-- 3. Add push settings to parents
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS report_push_enabled boolean DEFAULT true;
