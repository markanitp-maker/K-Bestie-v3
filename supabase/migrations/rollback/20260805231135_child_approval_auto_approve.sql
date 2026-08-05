ALTER TABLE public.child_approval_requests DROP CONSTRAINT IF EXISTS child_approval_requests_approval_method_check;

ALTER TABLE public.child_approval_requests DROP CONSTRAINT IF EXISTS child_approval_requests_status_check;
ALTER TABLE public.child_approval_requests ADD CONSTRAINT child_approval_requests_status_check 
  CHECK (status IN ('pending', 'approved', 'rejected', 'creation_failed'));

ALTER TABLE public.child_approval_requests
  DROP COLUMN IF EXISTS approval_method,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS payment_id,
  DROP COLUMN IF EXISTS payment_status;

CREATE OR REPLACE FUNCTION public.admin_finalize_child_approval_success(
  p_request_id UUID,
  p_admin_user_id UUID,
  p_admin_email TEXT,
  p_child_id UUID
)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  UPDATE public.child_approval_requests
  SET status = 'approved',
      created_child_id = p_child_id,
      reviewed_at = now(),
      reviewed_by = p_admin_user_id,
      processing_started_at = NULL,
      encrypted_password = NULL,
      updated_at = now()
  WHERE id = p_request_id
  RETURNING family_id INTO v_family_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, child_id)
  VALUES (p_admin_user_id, p_admin_email, 'child_approval_request_approved', v_family_id, p_child_id);

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.admin_finalize_child_approval_success(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finalize_child_approval_success(UUID, UUID, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.create_child_approval_request(
  p_family_id UUID,
  p_requested_by UUID,
  p_family_creator_id UUID,
  p_requester_email TEXT,
  p_family_creator_email TEXT,
  p_family_name TEXT,
  p_given_name TEXT,
  p_gender TEXT,
  p_username TEXT,
  p_password TEXT,
  p_encryption_key TEXT,
  p_grade TEXT,
  p_interests TEXT[],
  p_guardian_consent BOOLEAN,
  p_guardian_consent_version TEXT
)
RETURNS TABLE(success BOOLEAN, reason TEXT, request_id UUID)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_request_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('child_approval_request_username_' || p_username));

  IF NOT p_guardian_consent THEN
    RETURN QUERY SELECT false, 'guardian_consent_required'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.member_accounts WHERE username = p_username) THEN
    RETURN QUERY SELECT false, 'username_taken'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.child_approval_requests
    WHERE username = p_username AND status IN ('pending', 'creation_failed')
  ) THEN
    RETURN QUERY SELECT false, 'username_taken'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.child_approval_requests (
    family_id, requested_by, family_creator_id, requester_email, family_creator_email,
    family_name, given_name, gender, username, encrypted_password,
    grade, interests, guardian_consent, guardian_consent_version
  ) VALUES (
    p_family_id, p_requested_by, p_family_creator_id, p_requester_email, p_family_creator_email,
    p_family_name, p_given_name, p_gender, p_username, pgp_sym_encrypt(p_password, p_encryption_key),
    p_grade, p_interests, p_guardian_consent, p_guardian_consent_version
  ) RETURNING id INTO v_request_id;

  RETURN QUERY SELECT true, NULL::TEXT, v_request_id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_child_approval_request(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_child_approval_request(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], BOOLEAN, TEXT) TO service_role;
