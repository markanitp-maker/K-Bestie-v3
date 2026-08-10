-- 073 Mission v3 Phase 3: forward-only daily_single policy metadata and guardrails.
-- Existing mission_progress rows remain v2_dual and are never rewritten.

ALTER TABLE public.mission_progress
  ADD COLUMN IF NOT EXISTS mission_policy_version text NOT NULL DEFAULT 'v2_dual',
  ADD COLUMN IF NOT EXISTS effective_at timestamptz;

-- PostgreSQL cannot append a literal to an existing CHECK expression in place.
-- Replace only the round_type CHECK, retaining every legacy value and adding
-- daily_single. This changes no row and remains safe inside the migration transaction.
DO $migration$
DECLARE
  existing_constraint_name text;
  supports_daily_single boolean;
BEGIN
  SELECT COALESCE(bool_or(position('daily_single' IN pg_get_constraintdef(oid)) > 0), false)
    INTO supports_daily_single
  FROM pg_constraint
  WHERE conrelid = 'public.mission_progress'::regclass
    AND contype = 'c'
    AND position('round_type' IN pg_get_constraintdef(oid)) > 0
    AND position('round1_day' IN pg_get_constraintdef(oid)) > 0
    AND position('round2_night' IN pg_get_constraintdef(oid)) > 0;

  IF NOT supports_daily_single THEN
    SELECT conname
      INTO existing_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'public.mission_progress'::regclass
      AND contype = 'c'
      AND position('round_type' IN pg_get_constraintdef(oid)) > 0
      AND position('round1_day' IN pg_get_constraintdef(oid)) > 0
      AND position('round2_night' IN pg_get_constraintdef(oid)) > 0
    ORDER BY oid
    LIMIT 1;

    IF existing_constraint_name IS NULL THEN
      RAISE EXCEPTION 'mission_progress round_type CHECK constraint not found';
    END IF;

    EXECUTE format(
      'ALTER TABLE public.mission_progress DROP CONSTRAINT %I',
      existing_constraint_name
    );

    ALTER TABLE public.mission_progress
      ADD CONSTRAINT mission_progress_round_type_check_v3
      CHECK (round_type IN ('round1_day', 'round2_night', 'common', 'daily_single'))
      NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE public.mission_progress
  VALIDATE CONSTRAINT mission_progress_round_type_check_v3;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.mission_progress'::regclass
      AND conname = 'mission_progress_policy_version_check'
  ) THEN
    ALTER TABLE public.mission_progress
      ADD CONSTRAINT mission_progress_policy_version_check
      CHECK (mission_policy_version IN ('v2_dual', 'v3_single_daily'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.mission_progress'::regclass
      AND conname = 'mission_progress_policy_round_check'
  ) THEN
    ALTER TABLE public.mission_progress
      ADD CONSTRAINT mission_progress_policy_round_check
      CHECK (
        (
          mission_policy_version = 'v2_dual'
          AND round_type IN ('round1_day', 'round2_night', 'common')
          AND effective_at IS NULL
        )
        OR (
          mission_policy_version = 'v3_single_daily'
          AND round_type = 'daily_single'
          AND effective_at IS NOT NULL
          AND created_at >= effective_at
        )
      )
      NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE public.mission_progress
  VALIDATE CONSTRAINT mission_progress_policy_version_check;

ALTER TABLE public.mission_progress
  VALIDATE CONSTRAINT mission_progress_policy_round_check;

CREATE UNIQUE INDEX IF NOT EXISTS mission_progress_daily_single_child_date_key
  ON public.mission_progress (child_id, business_date)
  WHERE round_type = 'daily_single';

COMMENT ON COLUMN public.mission_progress.mission_policy_version IS
  'Policy snapshot for the session: v2_dual preserves legacy rounds; v3_single_daily is valid only after effective_at.';

COMMENT ON COLUMN public.mission_progress.effective_at IS
  'Mission v3 Production cutover instant copied into each v3_single_daily session; NULL for legacy sessions.';
