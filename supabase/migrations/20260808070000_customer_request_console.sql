-- 077: 고객 접수 통합 콘솔. 기존 행은 한 건도 변경하지 않고 허용 category만 확장한다.
ALTER TABLE public.support_requests DROP CONSTRAINT IF EXISTS support_requests_category_check;
ALTER TABLE public.support_requests
  ADD CONSTRAINT support_requests_category_check
  CHECK (category IN ('inquiry', 'suggestion', 'bug', 'voc'));

CREATE INDEX IF NOT EXISTS idx_support_requests_active_category_status_created
  ON public.support_requests (category, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.admin_update_support_request_v1(
  p_request_id uuid,
  p_status text DEFAULT NULL,
  p_admin_note text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_admin_user_id uuid DEFAULT NULL,
  p_admin_email text DEFAULT NULL,
  p_request_trace_id text DEFAULT NULL
) RETURNS public.support_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before public.support_requests%ROWTYPE;
  v_after public.support_requests%ROWTYPE;
  v_statuses constant text[] := ARRAY['open','in_progress','resolved','closed'];
  v_from_index integer;
  v_to_index integer;
  v_action text;
BEGIN
  SELECT * INTO v_before
  FROM public.support_requests
  WHERE id = p_request_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  IF p_status IS NOT NULL THEN
    v_from_index := array_position(v_statuses, v_before.status);
    v_to_index := array_position(v_statuses, p_status);
    IF v_to_index IS NULL OR (v_to_index <> v_from_index AND v_to_index <> v_from_index + 1) THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION';
    END IF;
  END IF;

  IF p_category IS NOT NULL AND p_category <> v_before.category THEN
    IF v_before.category <> 'voc' OR p_category NOT IN ('inquiry','suggestion') THEN
      RAISE EXCEPTION 'INVALID_CATEGORY_RECLASSIFICATION';
    END IF;
  END IF;

  UPDATE public.support_requests
  SET status = COALESCE(p_status, status),
      admin_note = p_admin_note,
      category = COALESCE(p_category, category),
      resolved_at = CASE WHEN p_status = 'resolved' AND resolved_at IS NULL THEN now() ELSE resolved_at END
  WHERE id = p_request_id
  RETURNING * INTO v_after;

  v_action := CASE
    WHEN v_before.category IS DISTINCT FROM v_after.category THEN 'CATEGORY_RECLASSIFIED'
    WHEN v_before.status IS DISTINCT FROM v_after.status THEN 'SUPPORT_STATUS_CHANGED'
    ELSE 'SUPPORT_NOTE_UPDATED'
  END;

  INSERT INTO public.admin_audit_log (
    admin_user_id, admin_email, action, resource_type, resource_id,
    before_snapshot, after_snapshot, request_id, source
  ) VALUES (
    p_admin_user_id, COALESCE(p_admin_email, ''), v_action, 'support_requests', p_request_id::text,
    jsonb_build_object('request_number',v_before.request_number,'category',v_before.category,'status',v_before.status,'admin_note',v_before.admin_note),
    jsonb_build_object('request_number',v_after.request_number,'category',v_after.category,'status',v_after.status,'admin_note',v_after.admin_note),
    p_request_trace_id, 'admin-customer-requests'
  );

  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bulk_update_support_request_status_v1(
  p_request_ids uuid[],
  p_status text,
  p_admin_user_id uuid DEFAULT NULL,
  p_admin_email text DEFAULT NULL,
  p_request_trace_id text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  IF p_request_ids IS NULL OR cardinality(p_request_ids) = 0 OR cardinality(p_request_ids) > 200 THEN
    RAISE EXCEPTION 'INVALID_BULK_SIZE';
  END IF;
  FOREACH v_id IN ARRAY p_request_ids LOOP
    PERFORM public.admin_update_support_request_v1(
      v_id, p_status, (SELECT admin_note FROM public.support_requests WHERE id = v_id), NULL,
      p_admin_user_id, p_admin_email, p_request_trace_id
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_support_request_v1(uuid,text,text,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_bulk_update_support_request_status_v1(uuid[],text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_support_request_v1(uuid,text,text,text,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_bulk_update_support_request_status_v1(uuid[],text,uuid,text,text) TO service_role;
