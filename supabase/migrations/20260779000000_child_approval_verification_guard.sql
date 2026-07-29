-- 053 보완: 관리자 화면 체크만으로 승인 조건을 흉내 내지 않고 DB에서도
-- 베타 신청 확인과 설문 완료 확인을 모두 강제한다.

DROP FUNCTION IF EXISTS public.admin_claim_child_approval_request(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.admin_claim_child_approval_request(
  p_request_id UUID,
  p_encryption_key TEXT,
  p_beta_verified BOOLEAN,
  p_survey_verified BOOLEAN
)
RETURNS TABLE(
  success BOOLEAN, reason TEXT,
  family_id UUID, family_name TEXT, given_name TEXT, gender TEXT,
  username TEXT, decrypted_password TEXT, grade TEXT, interests TEXT[],
  guardian_consent BOOLEAN, guardian_consent_version TEXT,
  guardian_consent_requested_at TIMESTAMPTZ,
  created_auth_user_id UUID, created_child_id UUID
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row public.child_approval_requests;
BEGIN
  IF p_beta_verified IS NOT TRUE OR p_survey_verified IS NOT TRUE THEN
    RETURN QUERY SELECT false, 'verification_required'::TEXT,
      NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT[],
      NULL::BOOLEAN, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  UPDATE public.child_approval_requests
  SET processing_started_at = now(),
      beta_verified = true,
      survey_verified = true,
      updated_at = now()
  WHERE id = p_request_id
    AND status IN ('pending', 'creation_failed')
    AND (processing_started_at IS NULL OR processing_started_at < now() - INTERVAL '2 minutes')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_claimable'::TEXT,
      NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT[],
      NULL::BOOLEAN, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true, NULL::TEXT,
    v_row.family_id, v_row.family_name, v_row.given_name, v_row.gender,
    v_row.username,
    CASE WHEN v_row.created_auth_user_id IS NULL
      THEN pgp_sym_decrypt(v_row.encrypted_password, p_encryption_key)
      ELSE NULL END,
    v_row.grade, v_row.interests,
    v_row.guardian_consent, v_row.guardian_consent_version,
    v_row.requested_at,
    v_row.created_auth_user_id, v_row.created_child_id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.admin_claim_child_approval_request(
  UUID, TEXT, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_child_approval_request(
  UUID, TEXT, BOOLEAN, BOOLEAN
) TO service_role;
