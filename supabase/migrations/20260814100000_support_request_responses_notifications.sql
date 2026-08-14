-- Request 028: 기존 CS 원장에 공개 답변과 원자적 사용자 알림을 추가한다.
-- 기존 admin_note(운영자 전용)와 user_response(사용자 공개)는 끝까지 분리한다.

ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS user_response text,
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS responded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS response_version integer NOT NULL DEFAULT 0;

ALTER TABLE public.support_requests
  DROP CONSTRAINT IF EXISTS support_requests_user_response_length_check;
ALTER TABLE public.support_requests
  ADD CONSTRAINT support_requests_user_response_length_check
  CHECK (user_response IS NULL OR char_length(user_response) BETWEEN 1 AND 2000);

COMMENT ON COLUMN public.support_requests.user_response IS
  '사용자에게 공개하는 관리자 공식 답변. admin_note와 분리하며 1~2000자만 허용한다.';
COMMENT ON COLUMN public.support_requests.response_version IS
  '공개 답변이 실제 변경될 때만 증가하는 알림 멱등 버전';

-- 기존 테이블 SELECT 권한은 모든 컬럼을 열어 admin_note까지 직접 조회할 수 있었다.
-- 앱은 서버 API를 사용하지만 DB 경계에서도 운영 메모와 내부 식별자를 닫는다.
REVOKE ALL ON public.support_requests FROM anon, authenticated;
GRANT SELECT (
  id, user_id, child_id, category, subject, body, status,
  created_at, updated_at, resolved_at, request_number, submitter_role,
  app_surface, user_response, responded_at, response_version
) ON public.support_requests TO authenticated;
GRANT ALL ON public.support_requests TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_support_request_v2(
  p_request_id uuid,
  p_status text DEFAULT NULL,
  p_admin_note text DEFAULT NULL,
  p_user_response text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_admin_user_id uuid DEFAULT NULL,
  p_admin_email text DEFAULT NULL,
  p_request_trace_id text DEFAULT NULL
) RETURNS jsonb
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
  v_response text;
  v_response_changed boolean := false;
  v_status_changed boolean := false;
  v_category_changed boolean := false;
  v_admin_note_changed boolean := false;
  v_notification_id uuid;
  v_notification_ids uuid[] := ARRAY[]::uuid[];
  v_role text;
  v_title text;
  v_body text;
  v_event text;
BEGIN
  SELECT * INTO v_before
  FROM public.support_requests
  WHERE id = p_request_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- 동일 trace의 서버 재시도는 row lock 뒤 기존 audit를 확인해 완전히 멱등 처리한다.
  IF p_request_trace_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.admin_audit_log
    WHERE resource_type = 'support_requests'
      AND resource_id = p_request_id::text
      AND request_id = p_request_trace_id
      AND source = 'admin-customer-requests'
  ) THEN
    RETURN jsonb_build_object(
      'request', to_jsonb(v_before),
      'notification_ids', '[]'::jsonb
    );
  END IF;

  IF p_status IS NOT NULL THEN
    v_from_index := array_position(v_statuses, v_before.status);
    v_to_index := array_position(v_statuses, p_status);
    IF v_to_index IS NULL
       OR (v_to_index <> v_from_index AND v_to_index <> v_from_index + 1) THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION';
    END IF;
  END IF;

  IF p_category IS NOT NULL AND p_category <> v_before.category THEN
    IF v_before.category <> 'voc' OR p_category NOT IN ('inquiry','suggestion') THEN
      RAISE EXCEPTION 'INVALID_CATEGORY_RECLASSIFICATION';
    END IF;
  END IF;

  IF p_user_response IS NOT NULL THEN
    v_response := btrim(p_user_response);
    IF char_length(v_response) < 1 OR char_length(v_response) > 2000 THEN
      RAISE EXCEPTION 'INVALID_USER_RESPONSE_LENGTH';
    END IF;
    v_response_changed := v_response IS DISTINCT FROM v_before.user_response;
  ELSE
    v_response := v_before.user_response;
  END IF;

  v_status_changed := p_status IS NOT NULL AND p_status IS DISTINCT FROM v_before.status;
  v_category_changed := p_category IS NOT NULL AND p_category IS DISTINCT FROM v_before.category;
  v_admin_note_changed := p_admin_note IS NOT NULL AND p_admin_note IS DISTINCT FROM v_before.admin_note;

  -- 헤더가 바뀐 일반 재시도라도 값이 같으면 updated_at/audit/notification을 늘리지 않는다.
  IF NOT v_status_changed
     AND NOT v_category_changed
     AND NOT v_admin_note_changed
     AND NOT v_response_changed THEN
    RETURN jsonb_build_object(
      'request', to_jsonb(v_before),
      'notification_ids', '[]'::jsonb
    );
  END IF;

  UPDATE public.support_requests
  SET status = COALESCE(p_status, status),
      admin_note = CASE WHEN p_admin_note IS NOT NULL THEN p_admin_note ELSE admin_note END,
      user_response = v_response,
      responded_at = CASE WHEN v_response_changed THEN now() ELSE responded_at END,
      responded_by = CASE WHEN v_response_changed THEN p_admin_user_id ELSE responded_by END,
      response_version = CASE WHEN v_response_changed THEN response_version + 1 ELSE response_version END,
      category = COALESCE(p_category, category),
      resolved_at = CASE WHEN p_status = 'resolved' AND resolved_at IS NULL THEN now() ELSE resolved_at END
  WHERE id = p_request_id
  RETURNING * INTO v_after;

  v_action := CASE
    WHEN v_response_changed AND v_status_changed THEN 'SUPPORT_RESPONSE_AND_STATUS_UPDATED'
    WHEN v_response_changed THEN 'SUPPORT_RESPONSE_UPDATED'
    WHEN v_category_changed THEN 'CATEGORY_RECLASSIFIED'
    WHEN v_status_changed THEN 'SUPPORT_STATUS_CHANGED'
    ELSE 'SUPPORT_NOTE_UPDATED'
  END;

  INSERT INTO public.admin_audit_log (
    admin_user_id, admin_email, action, resource_type, resource_id,
    before_snapshot, after_snapshot, request_id, source
  ) VALUES (
    p_admin_user_id, COALESCE(p_admin_email, ''), v_action,
    'support_requests', p_request_id::text,
    jsonb_build_object(
      'request_number', v_before.request_number,
      'category', v_before.category,
      'status', v_before.status,
      'admin_note', v_before.admin_note,
      'user_response', v_before.user_response,
      'response_version', v_before.response_version
    ),
    jsonb_build_object(
      'request_number', v_after.request_number,
      'category', v_after.category,
      'status', v_after.status,
      'admin_note', v_after.admin_note,
      'user_response', v_after.user_response,
      'response_version', v_after.response_version
    ),
    p_request_trace_id, 'admin-customer-requests'
  );

  -- landing guest는 user_id가 없으므로 inbox/Push 대상이 아니다.
  IF v_after.user_id IS NOT NULL
     AND v_after.submitter_role IN ('parent', 'child')
     AND (v_after.submitter_role <> 'child' OR v_after.child_id IS NOT NULL) THEN
    v_role := v_after.submitter_role;

    IF v_response_changed THEN
      v_event := 'response';
      v_title := CASE WHEN v_role = 'child'
        THEN '케이팀에서 답장이 왔어'
        ELSE '관리자 답변이 등록되었습니다'
      END;
      v_body := CASE WHEN v_role = 'child'
        THEN '접수한 내용을 확인해 봐.'
        ELSE '접수한 문의의 답변을 확인해 주세요.'
      END;

      INSERT INTO public.notifications (
        user_id, child_id, role, type, title, body, target_url,
        source_id, idempotency_key, metadata
      ) VALUES (
        v_after.user_id,
        CASE WHEN v_role = 'child' THEN v_after.child_id ELSE NULL END,
        v_role, 'system', v_title, v_body,
        '/support/requests/' || v_after.id::text,
        v_after.id::text,
        'support:' || v_after.id::text || ':response:' || v_after.response_version::text,
        jsonb_build_object(
          'event', v_event,
          'request_id', v_after.id,
          'request_number', v_after.request_number,
          'response_version', v_after.response_version
        )
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id INTO v_notification_id;

      IF v_notification_id IS NOT NULL THEN
        v_notification_ids := array_append(v_notification_ids, v_notification_id);
      END IF;
    END IF;

    v_notification_id := NULL;
    IF v_status_changed
       AND v_after.status IN ('in_progress', 'resolved') THEN
      v_event := 'status:' || v_after.status;
      v_title := CASE
        WHEN v_role = 'child' AND v_after.status = 'in_progress' THEN '접수를 처리하고 있어'
        WHEN v_role = 'child' THEN '접수 처리가 끝났어'
        WHEN v_after.status = 'in_progress' THEN '문의 처리가 시작되었습니다'
        ELSE '문의 처리가 완료되었습니다'
      END;
      v_body := CASE
        WHEN v_after.status = 'in_progress' THEN '접수 상태가 처리 중으로 변경되었습니다.'
        ELSE '접수 상태가 처리 완료로 변경되었습니다.'
      END;

      INSERT INTO public.notifications (
        user_id, child_id, role, type, title, body, target_url,
        source_id, idempotency_key, metadata
      ) VALUES (
        v_after.user_id,
        CASE WHEN v_role = 'child' THEN v_after.child_id ELSE NULL END,
        v_role, 'system', v_title, v_body,
        '/support/requests/' || v_after.id::text,
        v_after.id::text,
        'support:' || v_after.id::text || ':status:' || v_after.status,
        jsonb_build_object(
          'event', v_event,
          'request_id', v_after.id,
          'request_number', v_after.request_number,
          'status', v_after.status
        )
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id INTO v_notification_id;

      IF v_notification_id IS NOT NULL THEN
        v_notification_ids := array_append(v_notification_ids, v_notification_id);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'request', to_jsonb(v_after),
    'notification_ids', to_jsonb(v_notification_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_support_request_v2(
  uuid,text,text,text,text,uuid,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_support_request_v2(
  uuid,text,text,text,text,uuid,text,text
) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_bulk_update_support_request_status_v2(
  p_request_ids uuid[],
  p_status text,
  p_admin_user_id uuid DEFAULT NULL,
  p_admin_email text DEFAULT NULL,
  p_request_trace_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_result jsonb;
  v_count integer := 0;
  v_notification_ids jsonb := '[]'::jsonb;
BEGIN
  IF p_request_ids IS NULL
     OR cardinality(p_request_ids) = 0
     OR cardinality(p_request_ids) > 200 THEN
    RAISE EXCEPTION 'INVALID_BULK_SIZE';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('open','in_progress','resolved','closed') THEN
    RAISE EXCEPTION 'INVALID_BULK_STATUS';
  END IF;

  -- 같은 id가 중복돼도 한 번만 처리하고 lock 순서를 고정해 교착 가능성을 줄인다.
  FOR v_id IN
    SELECT DISTINCT request_id
    FROM unnest(p_request_ids) AS request_id
    ORDER BY request_id
  LOOP
    v_result := public.admin_update_support_request_v2(
      v_id,
      p_status,
      NULL,
      NULL,
      NULL,
      p_admin_user_id,
      p_admin_email,
      CASE WHEN p_request_trace_id IS NULL
        THEN NULL
        ELSE p_request_trace_id || ':' || v_id::text
      END
    );
    v_count := v_count + 1;
    v_notification_ids := v_notification_ids || COALESCE(v_result->'notification_ids', '[]'::jsonb);
  END LOOP;

  RETURN jsonb_build_object(
    'updated_count', v_count,
    'notification_ids', v_notification_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_update_support_request_status_v2(
  uuid[],text,uuid,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_update_support_request_status_v2(
  uuid[],text,uuid,text,text
) TO service_role;
