-- Migration: 20260806130000_signup_consents_rpc_and_partial_index.sql
-- 1) Drop full non-partial unique index (which blocked consent withdrawal & re-consent history)
DROP INDEX IF EXISTS public.signup_consents_user_type_doc_unique;

-- 2) Re-assert partial unique index: maximum 1 ACTIVE consent per (user_id, consent_type, document_version)
CREATE UNIQUE INDEX IF NOT EXISTS signup_consents_active_unique
  ON public.signup_consents (user_id, consent_type, document_version)
  WHERE (withdrawn_at IS NULL);

-- 3) Create Server-Side Transaction RPC for atomic, idempotent signup consent recording
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
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_consents)
  LOOP
    v_consent_type := v_item->>'consent_type';
    v_doc_version := v_item->>'document_version';
    v_agreed := COALESCE((v_item->>'agreed')::boolean, false);

    -- Find existing active consent row (withdrawn_at IS NULL) for this consent_type
    SELECT id, document_version, agreed
    INTO v_existing
    FROM public.signup_consents
    WHERE user_id = p_user_id
      AND consent_type = v_consent_type
      AND withdrawn_at IS NULL
    FOR UPDATE;

    IF v_existing.id IS NOT NULL THEN
      IF v_existing.agreed = v_agreed AND v_existing.document_version = v_doc_version THEN
        -- Idempotent case: exact same consent requested, no change
        v_unchanged_count := v_unchanged_count + 1;
      ELSE
        -- Consent state, document version changed, or withdrawn: mark previous active row as withdrawn
        UPDATE public.signup_consents
        SET withdrawn_at = v_now
        WHERE id = v_existing.id;
        v_updated_count := v_updated_count + 1;

        -- Insert new evidence audit row
        INSERT INTO public.signup_consents (
          user_id,
          consent_type,
          document_version,
          agreed,
          agreed_at,
          ip_address,
          user_agent,
          auth_method,
          is_reconsent
        ) VALUES (
          p_user_id,
          v_consent_type,
          v_doc_version,
          v_agreed,
          v_now,
          p_ip_address,
          p_user_agent,
          p_auth_method,
          true
        );
        v_inserted_count := v_inserted_count + 1;
      END IF;
    ELSE
      -- Initial consent: INSERT active consent row
      INSERT INTO public.signup_consents (
        user_id,
        consent_type,
        document_version,
        agreed,
        agreed_at,
        ip_address,
        user_agent,
        auth_method,
        is_reconsent
      ) VALUES (
        p_user_id,
        v_consent_type,
        v_doc_version,
        v_agreed,
        v_now,
        p_ip_address,
        p_user_agent,
        p_auth_method,
        false
      );
      v_inserted_count := v_inserted_count + 1;
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
