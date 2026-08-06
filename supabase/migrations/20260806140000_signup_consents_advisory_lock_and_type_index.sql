-- Migration: 20260806140000_signup_consents_advisory_lock_and_type_index.sql

-- 1) Drop previous version-specific partial index if exists
DROP INDEX IF EXISTS public.signup_consents_active_unique;
DROP INDEX IF EXISTS public.signup_consents_user_type_doc_unique;

-- 2) Create version-agnostic partial unique index:
--    Guarantees at most 1 ACTIVE consent row per (user_id, consent_type) across all document versions
CREATE UNIQUE INDEX IF NOT EXISTS signup_consents_user_type_active_unique
  ON public.signup_consents (user_id, consent_type)
  WHERE (withdrawn_at IS NULL);

-- 3) Upgrade Server-Side Transaction RPC with Transaction Advisory Locks and Exception Handling
CREATE OR REPLACE FUNCTION public.record_user_signup_consents(
  p_user_id UUID,
  p_consents JSONB,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_auth_method TEXT DEFAULT 'unknown'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_consent_type TEXT;
  v_doc_version TEXT;
  v_agreed BOOLEAN;
  v_existing RECORD;
  v_now TIMESTAMPTZ := now();
  v_inserted_count INT := 0;
  v_updated_count INT := 0;
  v_unchanged_count INT := 0;
  v_lock_key BIGINT;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_consents)
  LOOP
    v_consent_type := v_item->>'consent_type';
    v_doc_version := v_item->>'document_version';
    v_agreed := COALESCE((v_item->>'agreed')::boolean, false);

    -- Transaction-level advisory lock per user_id + consent_type to prevent parallel race conditions on initial row insertion
    v_lock_key := hashtext(p_user_id::text || '_' || v_consent_type);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- Find existing active consent for user_id + consent_type (version-agnostic)
    SELECT id, document_version, agreed
    INTO v_existing
    FROM public.signup_consents
    WHERE user_id = p_user_id
      AND consent_type = v_consent_type
      AND withdrawn_at IS NULL
    FOR UPDATE;

    IF v_existing.id IS NOT NULL THEN
      IF v_existing.agreed = v_agreed AND v_existing.document_version = v_doc_version THEN
        -- Exact match: idempotent, no change needed
        v_unchanged_count := v_unchanged_count + 1;
      ELSE
        -- State or document version changed (e.g. v1 -> v2 or agreed -> false): mark old active row as withdrawn
        UPDATE public.signup_consents
        SET withdrawn_at = v_now
        WHERE id = v_existing.id;
        v_updated_count := v_updated_count + 1;

        -- Insert new active evidence row with exception handling
        BEGIN
          INSERT INTO public.signup_consents (
            user_id, consent_type, document_version, agreed,
            agreed_at, ip_address, user_agent, auth_method, is_reconsent
          ) VALUES (
            p_user_id, v_consent_type, v_doc_version, v_agreed,
            v_now, p_ip_address, p_user_agent, p_auth_method, true
          );
          v_inserted_count := v_inserted_count + 1;
        EXCEPTION WHEN unique_violation THEN
          -- Fallback if parallel transaction inserted active row first: mark it withdrawn and insert
          UPDATE public.signup_consents
          SET withdrawn_at = v_now
          WHERE user_id = p_user_id AND consent_type = v_consent_type AND withdrawn_at IS NULL;

          INSERT INTO public.signup_consents (
            user_id, consent_type, document_version, agreed,
            agreed_at, ip_address, user_agent, auth_method, is_reconsent
          ) VALUES (
            p_user_id, v_consent_type, v_doc_version, v_agreed,
            v_now, p_ip_address, p_user_agent, p_auth_method, true
          );
          v_inserted_count := v_inserted_count + 1;
        END;
      END IF;
    ELSE
      -- Initial consent row insertion
      BEGIN
        INSERT INTO public.signup_consents (
          user_id, consent_type, document_version, agreed,
          agreed_at, ip_address, user_agent, auth_method, is_reconsent
        ) VALUES (
          p_user_id, v_consent_type, v_doc_version, v_agreed,
          v_now, p_ip_address, p_user_agent, p_auth_method, false
        );
        v_inserted_count := v_inserted_count + 1;
      EXCEPTION WHEN unique_violation THEN
        -- Fallback if parallel transaction inserted initial active row first: mark it withdrawn and insert
        UPDATE public.signup_consents
        SET withdrawn_at = v_now
        WHERE user_id = p_user_id AND consent_type = v_consent_type AND withdrawn_at IS NULL;

        INSERT INTO public.signup_consents (
          user_id, consent_type, document_version, agreed,
          agreed_at, ip_address, user_agent, auth_method, is_reconsent
        ) VALUES (
          p_user_id, v_consent_type, v_doc_version, v_agreed,
          v_now, p_ip_address, p_user_agent, p_auth_method, true
        );
        v_inserted_count := v_inserted_count + 1;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted_count,
    'updated', v_updated_count,
    'unchanged', v_unchanged_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_user_signup_consents FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_signup_consents TO service_role;
