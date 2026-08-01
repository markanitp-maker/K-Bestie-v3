-- 20260801380000_cleanup_retention_v3.sql
-- V3 Cleanup and 7-day Retention Pipeline Migration

-- 1. Enforce FK CASCADE on corrected_daily_conversations_v3 (both raw_daily_conversation_v3_id and legacy source_raw_id if present)
DO $$
BEGIN
  -- Recreate FK on raw_daily_conversation_v3_id actually used by correction writes
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'corrected_daily_conversations_v3_raw_daily_conversation_v3_id_fkey'
      AND table_name = 'corrected_daily_conversations_v3'
  ) THEN
    ALTER TABLE public.corrected_daily_conversations_v3
      DROP CONSTRAINT corrected_daily_conversations_v3_raw_daily_conversation_v3_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'corrected_daily_conversations_v3' AND column_name = 'raw_daily_conversation_v3_id'
  ) THEN
    -- Validate orphaned rows before adding FK constraint - RAISE exception instead of DELETE
    IF EXISTS (
      SELECT 1 FROM public.corrected_daily_conversations_v3
      WHERE raw_daily_conversation_v3_id NOT IN (SELECT id FROM public.raw_daily_conversations_v3)
    ) THEN
      RAISE EXCEPTION 'INCOMPATIBILITY_DETECTED: Orphan corrected daily conversation rows found before FK creation';
    END IF;

    ALTER TABLE public.corrected_daily_conversations_v3
      ADD CONSTRAINT corrected_daily_conversations_v3_raw_daily_conversation_v3_id_fkey
      FOREIGN KEY (raw_daily_conversation_v3_id)
      REFERENCES public.raw_daily_conversations_v3(id)
      ON DELETE CASCADE;
  END IF;

  -- Also recreate legacy source_raw_id FK if present
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'corrected_daily_conversations_v3_source_raw_id_fkey'
      AND table_name = 'corrected_daily_conversations_v3'
  ) THEN
    ALTER TABLE public.corrected_daily_conversations_v3
      DROP CONSTRAINT corrected_daily_conversations_v3_source_raw_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'corrected_daily_conversations_v3' AND column_name = 'source_raw_id'
  ) THEN
    ALTER TABLE public.corrected_daily_conversations_v3
      ADD CONSTRAINT corrected_daily_conversations_v3_source_raw_id_fkey
      FOREIGN KEY (source_raw_id)
      REFERENCES public.raw_daily_conversations_v3(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- 2. Index to accelerate chat_messages cleanup query on collected_at and id
CREATE INDEX IF NOT EXISTS idx_chat_messages_collected_at
  ON public.chat_messages (collected_at, id)
  WHERE collected_at IS NOT NULL;

-- 3. Atomic RPC for bounded chat_messages cleanup
CREATE OR REPLACE FUNCTION public.cleanup_chat_messages_v3(
  p_cutoff_at TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 1000
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_count INTEGER := 0;
BEGIN
  IF p_cutoff_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_cutoff_at cannot be null';
  END IF;

  IF p_cutoff_at > now() THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_cutoff_at cannot be in the future';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_limit must be an integer between 1 and 5000';
  END IF;

  WITH target_rows AS (
    SELECT id
    FROM public.chat_messages
    WHERE collected_at IS NOT NULL
      AND collected_at <= p_cutoff_at
    ORDER BY collected_at ASC, id ASC
    LIMIT p_limit
  ),
  deleted_rows AS (
    DELETE FROM public.chat_messages cm
    USING target_rows tr
    WHERE cm.id = tr.id
    RETURNING cm.id
  )
  SELECT count(*)::INTEGER INTO v_deleted_count FROM deleted_rows;

  RETURN v_deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_chat_messages_v3(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_chat_messages_v3(TIMESTAMPTZ, INTEGER) TO service_role;

-- 4. Atomic RPC for bounded V3 raw and corrected retention purge (7-day retention by business_date)
CREATE OR REPLACE FUNCTION public.purge_v3_retention_batch(
  p_cutoff_date DATE,
  p_limit INTEGER DEFAULT 1000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kst_today DATE;
  v_max_cutoff_date DATE;
  v_corrected_deleted INTEGER := 0;
  v_raw_deleted INTEGER := 0;
BEGIN
  IF p_cutoff_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_cutoff_date cannot be null';
  END IF;

  v_kst_today := (now() AT TIME ZONE 'Asia/Seoul')::DATE;
  v_max_cutoff_date := v_kst_today - 7;

  IF p_cutoff_date > v_max_cutoff_date THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_cutoff_date cannot be newer than 7 days ago';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_limit must be an integer between 1 and 5000';
  END IF;

  -- Step A: Delete bounded chunk of expired corrected daily conversations
  -- FK CASCADE will automatically purge child rows in corrected_daily_conversation_messages_v3
  WITH target_corrected AS (
    SELECT id
    FROM public.corrected_daily_conversations_v3
    WHERE business_date <= p_cutoff_date
    ORDER BY business_date ASC, id ASC
    LIMIT p_limit
  ),
  deleted_corrected AS (
    DELETE FROM public.corrected_daily_conversations_v3 c
    USING target_corrected tc
    WHERE c.id = tc.id
    RETURNING c.id
  )
  SELECT count(*)::INTEGER INTO v_corrected_deleted FROM deleted_corrected;

  -- Step B: Delete bounded chunk of expired raw daily conversations
  -- FK CASCADE will automatically purge child rows in raw_daily_conversation_messages_v3
  WITH target_raw AS (
    SELECT id
    FROM public.raw_daily_conversations_v3
    WHERE business_date <= p_cutoff_date
    ORDER BY business_date ASC, id ASC
    LIMIT p_limit
  ),
  deleted_raw AS (
    DELETE FROM public.raw_daily_conversations_v3 r
    USING target_raw tr
    WHERE r.id = tr.id
    RETURNING r.id
  )
  SELECT count(*)::INTEGER INTO v_raw_deleted FROM deleted_raw;

  RETURN jsonb_build_object(
    'cutoff_date', p_cutoff_date,
    'corrected_deleted', v_corrected_deleted,
    'raw_deleted', v_raw_deleted,
    'limit', p_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_v3_retention_batch(DATE, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_v3_retention_batch(DATE, INTEGER) TO service_role;
