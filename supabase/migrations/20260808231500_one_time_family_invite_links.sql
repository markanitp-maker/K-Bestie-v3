-- One-time family invite credentials extend the existing family_join_requests ledger.
-- Raw tokens/codes are never stored. Legacy email invites remain unchanged.

ALTER TABLE public.family_join_requests
  ALTER COLUMN requester_email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS invite_kind TEXT NOT NULL DEFAULT 'legacy_email',
  ADD COLUMN IF NOT EXISTS token_hash TEXT,
  ADD COLUMN IF NOT EXISTS code_hash TEXT,
  ADD COLUMN IF NOT EXISTS token_nonce TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consumed_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE public.family_join_requests
  DROP CONSTRAINT IF EXISTS family_join_requests_consumed_by_user_id_fkey;
ALTER TABLE public.family_join_requests
  ADD CONSTRAINT family_join_requests_consumed_by_user_id_fkey
    FOREIGN KEY (consumed_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.family_join_requests
  DROP CONSTRAINT IF EXISTS family_join_requests_invite_kind_check;
ALTER TABLE public.family_join_requests
  ADD CONSTRAINT family_join_requests_invite_kind_check
    CHECK (invite_kind IN ('legacy_email', 'one_time_link'));

ALTER TABLE public.family_join_requests
  DROP CONSTRAINT IF EXISTS family_join_requests_one_time_fields_check;
ALTER TABLE public.family_join_requests
  ADD CONSTRAINT family_join_requests_one_time_fields_check
    CHECK (
      invite_kind = 'legacy_email'
      OR (
        token_hash IS NOT NULL AND code_hash IS NOT NULL AND token_nonce IS NOT NULL
        AND expires_at IS NOT NULL AND requester_email IS NULL
      )
    );

ALTER TABLE public.family_join_requests
  DROP CONSTRAINT IF EXISTS family_join_requests_status_check;
ALTER TABLE public.family_join_requests
  ADD CONSTRAINT family_join_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_fjr_one_time_token_hash
  ON public.family_join_requests(token_hash)
  WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fjr_one_time_code_hash
  ON public.family_join_requests(code_hash)
  WHERE code_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fjr_one_time_pending_family
  ON public.family_join_requests(family_id)
  WHERE invite_kind = 'one_time_link' AND status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fjr_one_time_expiry
  ON public.family_join_requests(expires_at)
  WHERE invite_kind = 'one_time_link' AND status = 'pending';

CREATE OR REPLACE FUNCTION public.consume_one_time_family_invite(
  p_credential_hash TEXT,
  p_user_id UUID
) RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  joined_family_id UUID
) AS $$
DECLARE
  v_invite public.family_join_requests%ROWTYPE;
  v_existing_family_id UUID;
  v_parent_count INT;
  v_parent_status TEXT;
  v_parent_name TEXT;
  v_parent_relationship TEXT;
  v_guardian_confirmed_at TIMESTAMPTZ;
  v_has_required_consent BOOLEAN;
BEGIN
  IF p_credential_hash IS NULL OR p_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'invalid_credential'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- A user can accept only one family invite at a time, even across distinct tokens.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::TEXT));

  -- Resolve the authoritative family from the credential, then use the same
  -- family advisory lock as the legacy accept RPC so both acceptance paths
  -- serialize their capacity checks.
  SELECT * INTO v_invite
  FROM public.family_join_requests
  WHERE invite_kind = 'one_time_link'
    AND (token_hash = p_credential_hash OR code_hash = p_credential_hash);

  IF v_invite.id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_invite.family_id::TEXT));

  SELECT * INTO v_invite
  FROM public.family_join_requests
  WHERE id = v_invite.id
  FOR UPDATE;

  IF v_invite.status = 'approved' THEN
    IF v_invite.consumed_by_user_id = p_user_id
       AND EXISTS (
         SELECT 1 FROM public.family_members
         WHERE family_id = v_invite.family_id AND user_id = p_user_id
           AND role IN ('owner_parent', 'parent') AND deleted_at IS NULL
       )
       AND EXISTS (
         SELECT 1 FROM public.parents
         WHERE id = p_user_id AND account_status IN ('ACTIVE', 'RESTORED')
       ) THEN
      RETURN QUERY SELECT true, 'already_member'::TEXT, v_invite.family_id;
    ELSE
      RETURN QUERY SELECT false, 'consumed'::TEXT, NULL::UUID;
    END IF;
    RETURN;
  END IF;

  IF v_invite.status = 'cancelled' OR v_invite.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_invite.status = 'expired' OR v_invite.expires_at IS NULL OR v_invite.expires_at <= now() THEN
    UPDATE public.family_join_requests
    SET status = 'expired'
    WHERE id = v_invite.id AND status = 'pending';
    RETURN QUERY SELECT false, 'expired'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_invite.status <> 'pending' OR v_invite.direction <> 'owner_invite' THEN
    RETURN QUERY SELECT false, 'already_processed'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_invite.requester_user_id = p_user_id THEN
    RETURN QUERY SELECT false, 'self_invite'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.family_members
    WHERE user_id = p_user_id AND role = 'child' AND deleted_at IS NULL
  ) THEN
    RETURN QUERY SELECT false, 'account_role_conflict'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT account_status, name, relationship_to_child, legal_guardian_confirmed_at
  INTO v_parent_status, v_parent_name, v_parent_relationship, v_guardian_confirmed_at
  FROM public.parents
  WHERE id = p_user_id;

  IF v_parent_status IS NULL OR v_parent_status NOT IN (
    'AUTHENTICATED_INCOMPLETE', 'ONBOARDING', 'ACTIVE', 'RESTORED'
  ) THEN
    RETURN QUERY SELECT false, 'account_not_eligible'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.signup_consents
    WHERE user_id = p_user_id
      AND consent_type = 'service_terms'
      AND agreed = true
      AND withdrawn_at IS NULL
  ) INTO v_has_required_consent;

  IF NOT v_has_required_consent
     OR NULLIF(BTRIM(v_parent_name), '') IS NULL
     OR v_parent_relationship IS NULL
     OR v_guardian_confirmed_at IS NULL THEN
    RETURN QUERY SELECT false, 'onboarding_incomplete'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.families
    WHERE id = v_invite.family_id AND deleted_at IS NULL
  ) THEN
    RETURN QUERY SELECT false, 'family_not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT family_id INTO v_existing_family_id
  FROM public.family_members
  WHERE user_id = p_user_id
    AND role IN ('owner_parent', 'parent')
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_existing_family_id IS NOT NULL AND v_existing_family_id <> v_invite.family_id THEN
    RETURN QUERY SELECT false, 'existing_family_conflict'::TEXT, v_existing_family_id;
    RETURN;
  END IF;

  IF v_existing_family_id = v_invite.family_id THEN
    UPDATE public.family_join_requests
    SET status = 'approved', consumed_at = COALESCE(consumed_at, now()),
        consumed_by_user_id = p_user_id
    WHERE id = v_invite.id;
    UPDATE public.parents
    SET account_status = CASE
          WHEN account_status IN ('AUTHENTICATED_INCOMPLETE', 'ONBOARDING') THEN 'ACTIVE'
          ELSE account_status
        END,
        onboarding_completed_at = COALESCE(onboarding_completed_at, now())
    WHERE id = p_user_id;
    RETURN QUERY SELECT true, 'already_member'::TEXT, v_invite.family_id;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.family_members
    WHERE user_id = p_user_id AND deleted_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT false, 'account_restore_required'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_parent_count
  FROM public.family_members
  WHERE family_id = v_invite.family_id
    AND role IN ('owner_parent', 'parent')
    AND deleted_at IS NULL;
  IF v_parent_count >= 2 THEN
    RETURN QUERY SELECT false, 'capacity_full'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.family_members(family_id, user_id, role)
  VALUES (v_invite.family_id, p_user_id, 'parent');

  UPDATE public.family_join_requests
  SET status = 'approved', consumed_at = now(), consumed_by_user_id = p_user_id
  WHERE id = v_invite.id;

  UPDATE public.parents
  SET account_status = CASE
        WHEN account_status IN ('AUTHENTICATED_INCOMPLETE', 'ONBOARDING') THEN 'ACTIVE'
        ELSE account_status
      END,
      onboarding_completed_at = COALESCE(onboarding_completed_at, now())
  WHERE id = p_user_id;

  RETURN QUERY SELECT true, 'ok'::TEXT, v_invite.family_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.consume_one_time_family_invite(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_one_time_family_invite(TEXT, UUID) TO service_role;
