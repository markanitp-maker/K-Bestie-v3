-- 관리자 푸시 테스트가 정기 Cron 발송 멱등 원장을 오염시키지 않도록 출처를 분리한다.
ALTER TABLE public.mission_notification_logs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'cron';

ALTER TABLE public.mission_notification_logs
  DROP CONSTRAINT IF EXISTS mission_notification_logs_source_check;
ALTER TABLE public.mission_notification_logs
  ADD CONSTRAINT mission_notification_logs_source_check
  CHECK (source IN ('cron', 'admin_test'));

ALTER TABLE public.mission_notification_logs
  DROP CONSTRAINT IF EXISTS mission_notification_logs_child_id_business_date_round_type_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mission_notification_logs'::regclass
      AND conname = 'mission_notification_logs_child_date_round_source_key'
  ) THEN
    ALTER TABLE public.mission_notification_logs
      ADD CONSTRAINT mission_notification_logs_child_date_round_source_key
      UNIQUE (child_id, business_date, round_type, source);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mission_notification_logs_source_updated
  ON public.mission_notification_logs (source, updated_at DESC);
