-- Migration: 20260806150000_onboarding_state_machine_and_rpc_lock_order.sql

-- 1. Expand parents.account_status check constraint and set default to AUTHENTICATED_INCOMPLETE
ALTER TABLE public.parents DROP CONSTRAINT IF EXISTS parents_account_status_check;
ALTER TABLE public.parents ADD CONSTRAINT parents_account_status_check
  CHECK (account_status IN (
    'AUTHENTICATED_INCOMPLETE',
    'ONBOARDING',
    'ACTIVE',
    'WITHDRAWN_PENDING',
    'RESTORE_REQUESTED',
    'RESTORED',
    'PURGED',
    'SUSPENDED'
  ));

ALTER TABLE public.parents
  ALTER COLUMN account_status SET DEFAULT 'AUTHENTICATED_INCOMPLETE',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- 2. Upgrade handle_new_user() trigger to set default AUTHENTICATED_INCOMPLETE
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.parents (id, email, name, account_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    'AUTHENTICATED_INCOMPLETE'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3. Upgrade Server-Side Transaction RPC with Deterministic Lock Order and Post-Violation Re-Verification
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
  v_reselect RECORD;
BEGIN
  -- Process items in deterministic alphabetical order of consent_type to prevent deadlocks
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_consents) AS elem(value)
    ORDER BY value->>'consent_type' ASC
  LOOP
    v_consent_type := v_item->>'consent_type';
    v_doc_version := v_item->>'document_version';
    v_agreed := COALESCE((v_item->>'agreed')::boolean, false);

    -- 1. Acquire transaction-level advisory lock in deterministic order
    v_lock_key := hashtext(p_user_id::text || '_' || v_consent_type);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- 2. Find existing active consent for user_id + consent_type (version-agnostic)
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
        -- State or document version changed: mark old active row as withdrawn
        UPDATE public.signup_consents
        SET withdrawn_at = v_now
        WHERE id = v_existing.id;
        v_updated_count := v_updated_count + 1;

        -- Insert new active evidence row with exception handling & re-verification
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
          -- Re-select active row after violation to check if concurrent transaction inserted identical state
          SELECT id, document_version, agreed INTO v_reselect
          FROM public.signup_consents
          WHERE user_id = p_user_id AND consent_type = v_consent_type AND withdrawn_at IS NULL;

          IF v_reselect.id IS NOT NULL AND v_reselect.agreed = v_agreed AND v_reselect.document_version = v_doc_version THEN
            v_unchanged_count := v_unchanged_count + 1;
          ELSE
            UPDATE public.signup_consents SET withdrawn_at = v_now
            WHERE user_id = p_user_id AND consent_type = v_consent_type AND withdrawn_at IS NULL;

            INSERT INTO public.signup_consents (
              user_id, consent_type, document_version, agreed,
              agreed_at, ip_address, user_agent, auth_method, is_reconsent
            ) VALUES (
              p_user_id, v_consent_type, v_doc_version, v_agreed,
              v_now, p_ip_address, p_user_agent, p_auth_method, true
            );
            v_inserted_count := v_inserted_count + 1;
          END IF;
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
        -- Re-select active row after violation
        SELECT id, document_version, agreed INTO v_reselect
        FROM public.signup_consents
        WHERE user_id = p_user_id AND consent_type = v_consent_type AND withdrawn_at IS NULL;

        IF v_reselect.id IS NOT NULL AND v_reselect.agreed = v_agreed AND v_reselect.document_version = v_doc_version THEN
          v_unchanged_count := v_unchanged_count + 1;
        ELSE
          UPDATE public.signup_consents SET withdrawn_at = v_now
          WHERE user_id = p_user_id AND consent_type = v_consent_type AND withdrawn_at IS NULL;

          INSERT INTO public.signup_consents (
            user_id, consent_type, document_version, agreed,
            agreed_at, ip_address, user_agent, auth_method, is_reconsent
          ) VALUES (
            p_user_id, v_consent_type, v_doc_version, v_agreed,
            v_now, p_ip_address, p_user_agent, p_auth_method, true
          );
          v_inserted_count := v_inserted_count + 1;
        END IF;
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
