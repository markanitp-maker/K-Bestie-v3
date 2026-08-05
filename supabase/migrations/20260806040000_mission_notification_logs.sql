-- 미션 시작 시간 알림 발송 이력 (requests/request-mission-time-notification.md)
CREATE TABLE IF NOT EXISTS public.mission_notification_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    child_id uuid NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
    business_date date NOT NULL,
    round_type text NOT NULL CHECK (round_type IN ('round1_day', 'round2_night')),
    sent_at timestamptz DEFAULT now(),
    UNIQUE(child_id, business_date, round_type)
);

ALTER TABLE public.mission_notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY mission_notification_logs_service_all
    ON public.mission_notification_logs FOR ALL
    USING (auth.role() = 'service_role');
