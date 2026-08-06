-- 20260806170000_create_family_with_owner_rpc_fix.sql

-- 1. 온보딩 중인 부모(ONBOARDING, AUTHENTICATED_INCOMPLETE)도 owner_parent로서 제약조건을 통과할 수 있도록 트리거 보완
CREATE OR REPLACE FUNCTION public.fn_check_owner_succession_guard()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_family_ids UUID[] := '{}';
  v_user_ids UUID[] := '{}';
  v_fid UUID;
  v_uid UUID;
  v_account_status TEXT;
BEGIN
  -- 수집: 영향받은 family_id, user_id (NEW/OLD 양쪽 고려)
  IF TG_TABLE_NAME = 'families' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN v_family_ids := array_append(v_family_ids, OLD.id); END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN v_family_ids := array_append(v_family_ids, NEW.id); END IF;
  ELSIF TG_TABLE_NAME = 'family_members' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN 
      v_family_ids := array_append(v_family_ids, OLD.family_id); 
      v_user_ids := array_append(v_user_ids, OLD.user_id);
    END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN 
      v_family_ids := array_append(v_family_ids, NEW.family_id); 
      v_user_ids := array_append(v_user_ids, NEW.user_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'parents' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN v_user_ids := array_append(v_user_ids, OLD.id); END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN v_user_ids := array_append(v_user_ids, NEW.id); END IF;
  END IF;

  -- Constraint A: families.deleted_at IS NULL인 가족은 owner_parent가 최소 1명 존재해야 함 (온보딩 부모 포함)
  FOR v_fid IN SELECT DISTINCT unnest(v_family_ids) LOOP
    IF EXISTS (SELECT 1 FROM public.families WHERE id = v_fid AND deleted_at IS NULL) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.family_members fm
        JOIN public.parents p ON p.id = fm.user_id
        WHERE fm.family_id = v_fid
          AND fm.role = 'owner_parent'
          AND fm.deleted_at IS NULL
          AND p.account_status IN ('ACTIVE', 'RESTORED', 'ONBOARDING', 'AUTHENTICATED_INCOMPLETE')
      ) THEN
        RAISE EXCEPTION 'Constraint Violation: Active family % must have at least one active owner_parent.', v_fid;
      END IF;
    END IF;
  END LOOP;

  -- Constraint B: family_members.role='owner_parent' AND deleted_at IS NULL인 모든 행은 부모 계정이 유효해야 함
  FOR v_uid IN SELECT DISTINCT unnest(v_user_ids) LOOP
    IF EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.user_id = v_uid
        AND fm.role = 'owner_parent'
        AND fm.deleted_at IS NULL
    ) THEN
      SELECT account_status INTO v_account_status FROM public.parents WHERE id = v_uid;
      IF v_account_status IS NULL OR v_account_status NOT IN ('ACTIVE', 'RESTORED', 'ONBOARDING', 'AUTHENTICATED_INCOMPLETE') THEN
        RAISE EXCEPTION 'Constraint Violation: User % is an active owner_parent but account is invalid.', v_uid;
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 2. 단일 SECURITY DEFINER 트랜잭션으로 가족 생성 + 오너 연결을 원자적으로 수행하는 RPC
CREATE OR REPLACE FUNCTION public.create_family_with_owner(p_user_id UUID, p_name TEXT)
RETURNS TABLE(family_id UUID, family_name TEXT, created_at TIMESTAMPTZ, error_code TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_family_id UUID;
  v_existing_name TEXT;
  v_existing_created_at TIMESTAMPTZ;
  v_new_family_id UUID;
  v_new_created_at TIMESTAMPTZ;
BEGIN
  -- 1. 멱등성 체크: 이미 삭제되지 않은 가족 멤버십이 있는지 확인
  SELECT fm.family_id, f.name, f.created_at
    INTO v_existing_family_id, v_existing_name, v_existing_created_at
    FROM public.family_members fm
    JOIN public.families f ON f.id = fm.family_id
   WHERE fm.user_id = p_user_id
     AND fm.deleted_at IS NULL
     AND f.deleted_at IS NULL
   ORDER BY fm.joined_at ASC
   LIMIT 1;

  IF v_existing_family_id IS NOT NULL THEN
    -- 이미 소속된 가족이 존재하면 멱등하게 해당 가족 정보와 'already_member' 에러코드 반환
    RETURN QUERY SELECT v_existing_family_id, v_existing_name, v_existing_created_at, 'already_member'::TEXT;
    RETURN;
  END IF;

  -- 2. 안전한 3단계 원자적 생성:
  -- (a) 트리거의 ACTIVE 가족 검사를 우회하기 위해 먼저 deleted_at = now() (비활성)으로 INSERT
  INSERT INTO public.families (name, created_by, deleted_at) 
  VALUES (p_name, p_user_id, NOW()) 
  RETURNING id, public.families.created_at INTO v_new_family_id, v_new_created_at;

  -- (b) family_members에 owner_parent 연결
  INSERT INTO public.family_members (family_id, user_id, role) 
  VALUES (v_new_family_id, p_user_id, 'owner_parent');

  -- (c) 가족을 ACTIVE(deleted_at = NULL)로 전환 -> 트리거 검사 시점에 이미 owner_parent가 존재하므로 통과!
  UPDATE public.families
     SET deleted_at = NULL
   WHERE id = v_new_family_id;

  -- 3. 성공 반환
  RETURN QUERY SELECT v_new_family_id, p_name, v_new_created_at, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.create_family_with_owner(UUID, TEXT) TO authenticated, service_role;
