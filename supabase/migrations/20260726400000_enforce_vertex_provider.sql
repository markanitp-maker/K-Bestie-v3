-- Group A/B/C를 프로덕션과 동일하게 vertex로 전환(멱등)하고, 앞으로 vertex만 허용하도록
-- CHECK 제약을 강화한다. 과거 이력/감사로그는 건드리지 않으며, 오직 provider_switch_settings의
-- 현재 3개 설정 행만 갱신 대상이다.

UPDATE provider_switch_settings
SET
  provider = 'vertex',
  model_id = CASE
    WHEN "group" IN ('A', 'B') THEN 'gemini-2.5-flash'
    WHEN "group" = 'C' THEN 'gemini-2.5-flash-native-audio'
    ELSE model_id
  END,
  updated_at = now()
WHERE "group" IN ('A', 'B', 'C')
  AND (
    provider != 'vertex'
    OR model_id != CASE
      WHEN "group" IN ('A', 'B') THEN 'gemini-2.5-flash'
      WHEN "group" = 'C' THEN 'gemini-2.5-flash-native-audio'
      ELSE model_id
    END
  );

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'provider_switch_settings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%provider%'
  ) LOOP
    EXECUTE format('ALTER TABLE provider_switch_settings DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE provider_switch_settings
  ADD CONSTRAINT provider_switch_settings_provider_check CHECK (provider = 'vertex');
