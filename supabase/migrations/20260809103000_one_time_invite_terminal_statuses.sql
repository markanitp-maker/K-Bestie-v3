-- Make one-time invite terminal states explicit and auditable.
-- Legacy email invite rows keep their existing approved/cancelled states.

ALTER TABLE public.family_join_requests
  DROP CONSTRAINT IF EXISTS family_join_requests_status_check;
ALTER TABLE public.family_join_requests
  ADD CONSTRAINT family_join_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'consumed', 'revoked'));

UPDATE public.family_join_requests
SET status = 'consumed'
WHERE invite_kind = 'one_time_link'
  AND status = 'approved'
  AND consumed_at IS NOT NULL;

UPDATE public.family_join_requests
SET status = 'revoked'
WHERE invite_kind = 'one_time_link'
  AND status = 'cancelled'
  AND revoked_at IS NOT NULL;

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

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::TEXT));

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

  IF v_invite.status = 'consumed' THEN
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

  IF v_invite.status = 'revoked' OR v_invite.revoked_at IS NOT NULL THEN
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

  SELECT COUNT(DISTINCT consent_type) = 3
  INTO v_has_required_consent
  FROM public.signup_consents
  WHERE user_id = p_user_id
    AND consent_type IN ('service_terms', 'guardian_u14', 'guardian_authority')
    AND agreed = true
    AND withdrawn_at IS NULL;

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
    SET status = 'consumed', consumed_at = COALESCE(consumed_at, now()),
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
  SET status = 'consumed', consumed_at = now(), consumed_by_user_id = p_user_id
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
