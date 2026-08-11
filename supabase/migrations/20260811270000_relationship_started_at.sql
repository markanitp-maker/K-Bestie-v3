-- 075 Relationship Engine V1: 관계 시작일은 프로필 생성일이 아니라 최초 정상
-- CHILD -> K 왕복의 K 메시지 저장 시각이다. 기존 원문은 읽기만 하며 삭제/재생성하지 않는다.

ALTER TABLE public.child_profiles
  ADD COLUMN IF NOT EXISTS relationship_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS relationship_started_at_is_fallback boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.child_profiles.relationship_started_at IS
  '최초 정상 CHILD -> K 왕복에서 K chat_messages 행이 저장된 시각. 기존 데이터에 정상 턴이 없을 때만 child_profiles.created_at 임시 fallback.';
COMMENT ON COLUMN public.child_profiles.relationship_started_at_is_fallback IS
  'true면 과거 정상 왕복을 찾지 못해 child_profiles.created_at을 임시 사용한 기존 프로필. 최초 실제 정상 턴에서 false로 전환된다.';

DO $constraint$
BEGIN
  ALTER TABLE public.child_profiles
    ADD CONSTRAINT child_profiles_relationship_started_at_fallback_check
    CHECK (NOT relationship_started_at_is_fallback OR relationship_started_at IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$constraint$;

-- 미션 신규 경로는 mission_turns가 정확한 child_message_id/k_message_id를 보유한다.
-- 자유대화에는 공통 pair ID가 없으므로 display_sequence상 인접 child -> k를 쓴다.
-- display_sequence 도입 전 레거시 행만 created_at,id 순으로 별도 판정한다.
CREATE OR REPLACE FUNCTION public.find_first_relationship_turn_at(p_child_id uuid)
RETURNS timestamptz
LANGUAGE sql
-- AFTER INSERT 트리거에서 호출될 때 현재 문장이 방금 저장한 NEW 행까지 봐야 한다.
-- STABLE의 문장 시작 스냅샷을 쓰지 않도록 VOLATILE을 명시한다.
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH exact_mission_pairs AS (
    SELECT k.created_at AS completed_at
    FROM public.mission_turns mt
    JOIN public.chat_sessions s
      ON s.id = mt.session_id
    JOIN public.chat_messages child
      ON child.id = mt.child_message_id
     AND child.session_id = mt.session_id
     AND child.role = 'child'
    JOIN public.chat_messages k
      ON k.id = mt.k_message_id
     AND k.session_id = mt.session_id
     AND k.role = 'k'
    WHERE s.child_id = p_child_id
      AND s.deleted_at IS NULL
      AND s.session_type = 'mission'
      AND mt.status = 'FINALIZED'
      AND child.turn_status = 'finalized'
      AND k.turn_status = 'finalized'
      AND child.deleted_at IS NULL
      AND k.deleted_at IS NULL
      AND btrim(child.content) <> ''
      AND btrim(k.content) <> ''
  ), sequenced_messages AS (
    SELECT
      m.role,
      m.created_at,
      m.display_sequence,
      lag(m.role) OVER (
        PARTITION BY m.session_id
        ORDER BY m.display_sequence, m.created_at, m.id
      ) AS previous_role,
      lag(m.display_sequence) OVER (
        PARTITION BY m.session_id
        ORDER BY m.display_sequence, m.created_at, m.id
      ) AS previous_display_sequence
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON s.id = m.session_id
    WHERE s.child_id = p_child_id
      AND s.deleted_at IS NULL
      AND s.session_type = 'free_chat'
      AND m.deleted_at IS NULL
      AND m.turn_status = 'finalized'
      AND btrim(m.content) <> ''
      AND m.display_sequence IS NOT NULL
  ), sequenced_pairs AS (
    SELECT created_at AS completed_at
    FROM sequenced_messages
    WHERE role = 'k'
      AND previous_role = 'child'
      AND display_sequence = previous_display_sequence + 1
  ), legacy_messages AS (
    SELECT
      m.role,
      m.created_at,
      lag(m.role) OVER (
        PARTITION BY m.session_id
        ORDER BY m.created_at, m.id
      ) AS previous_role
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON s.id = m.session_id
    WHERE s.child_id = p_child_id
      AND s.deleted_at IS NULL
      AND s.session_type = 'free_chat'
      AND m.deleted_at IS NULL
      AND m.turn_status = 'finalized'
      AND btrim(m.content) <> ''
      AND m.display_sequence IS NULL
  ), legacy_pairs AS (
    SELECT created_at AS completed_at
    FROM legacy_messages
    WHERE role = 'k' AND previous_role = 'child'
  ), candidates AS (
    SELECT completed_at FROM exact_mission_pairs
    UNION ALL
    SELECT completed_at FROM sequenced_pairs
    UNION ALL
    SELECT completed_at FROM legacy_pairs
  )
  SELECT min(completed_at) FROM candidates;
$function$;

REVOKE ALL ON FUNCTION public.find_first_relationship_turn_at(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_first_relationship_turn_at(uuid) TO service_role;

-- 기존 프로필 backfill. 실제 정상 턴 후보가 있으면 그 최초 K 저장 시각을 쓰고,
-- 없을 때만 created_at을 임시 fallback으로 사용한다. 실제값은 절대 갱신하지 않으며
-- fallback만 나중에 발견된 실제 턴으로 교체할 수 있어 재실행해도 같은 결과다.
DO $backfill$
DECLARE
  v_actual_updated integer := 0;
  v_fallback_updated integer := 0;
  v_actual_total integer := 0;
  v_fallback_total integer := 0;
BEGIN
  WITH exact_mission_pairs AS (
    SELECT s.child_id, k.created_at AS completed_at
    FROM public.mission_turns mt
    JOIN public.chat_sessions s
      ON s.id = mt.session_id
    JOIN public.chat_messages child
      ON child.id = mt.child_message_id
     AND child.session_id = mt.session_id
     AND child.role = 'child'
    JOIN public.chat_messages k
      ON k.id = mt.k_message_id
     AND k.session_id = mt.session_id
     AND k.role = 'k'
    WHERE s.deleted_at IS NULL
      AND s.session_type = 'mission'
      AND mt.status = 'FINALIZED'
      AND child.turn_status = 'finalized'
      AND k.turn_status = 'finalized'
      AND child.deleted_at IS NULL
      AND k.deleted_at IS NULL
      AND btrim(child.content) <> ''
      AND btrim(k.content) <> ''
  ), sequenced_messages AS (
    SELECT
      s.child_id,
      m.role,
      m.created_at,
      m.display_sequence,
      lag(m.role) OVER (
        PARTITION BY m.session_id
        ORDER BY m.display_sequence, m.created_at, m.id
      ) AS previous_role,
      lag(m.display_sequence) OVER (
        PARTITION BY m.session_id
        ORDER BY m.display_sequence, m.created_at, m.id
      ) AS previous_display_sequence
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON s.id = m.session_id
    WHERE s.deleted_at IS NULL
      AND s.session_type = 'free_chat'
      AND m.deleted_at IS NULL
      AND m.turn_status = 'finalized'
      AND btrim(m.content) <> ''
      AND m.display_sequence IS NOT NULL
  ), sequenced_pairs AS (
    SELECT child_id, created_at AS completed_at
    FROM sequenced_messages
    WHERE role = 'k'
      AND previous_role = 'child'
      AND display_sequence = previous_display_sequence + 1
  ), legacy_messages AS (
    SELECT
      s.child_id,
      m.role,
      m.created_at,
      lag(m.role) OVER (
        PARTITION BY m.session_id
        ORDER BY m.created_at, m.id
      ) AS previous_role
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON s.id = m.session_id
    WHERE s.deleted_at IS NULL
      AND s.session_type = 'free_chat'
      AND m.deleted_at IS NULL
      AND m.turn_status = 'finalized'
      AND btrim(m.content) <> ''
      AND m.display_sequence IS NULL
  ), legacy_pairs AS (
    SELECT child_id, created_at AS completed_at
    FROM legacy_messages
    WHERE role = 'k' AND previous_role = 'child'
  ), candidates AS (
    SELECT child_id, completed_at FROM exact_mission_pairs
    UNION ALL
    SELECT child_id, completed_at FROM sequenced_pairs
    UNION ALL
    SELECT child_id, completed_at FROM legacy_pairs
  ), first_candidates AS (
    SELECT child_id, min(completed_at) AS started_at
    FROM candidates
    GROUP BY child_id
  )
  UPDATE public.child_profiles cp
  SET relationship_started_at = first_candidates.started_at,
      relationship_started_at_is_fallback = false
  FROM first_candidates
  WHERE cp.id = first_candidates.child_id
    AND (cp.relationship_started_at IS NULL OR cp.relationship_started_at_is_fallback);
  GET DIAGNOSTICS v_actual_updated = ROW_COUNT;

  UPDATE public.child_profiles
  SET relationship_started_at = created_at,
      relationship_started_at_is_fallback = true
  WHERE relationship_started_at IS NULL;
  GET DIAGNOSTICS v_fallback_updated = ROW_COUNT;

  SELECT count(*) FILTER (WHERE NOT relationship_started_at_is_fallback),
         count(*) FILTER (WHERE relationship_started_at_is_fallback)
  INTO v_actual_total, v_fallback_total
  FROM public.child_profiles
  WHERE relationship_started_at IS NOT NULL;

  RAISE NOTICE 'relationship_started_at backfill: actual_updated=%, fallback_updated=%, actual_total=%, fallback_total=%',
    v_actual_updated, v_fallback_updated, v_actual_total, v_fallback_total;
END
$backfill$;

CREATE OR REPLACE FUNCTION public.capture_relationship_started_at_from_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_child_id uuid;
  v_started_at timestamptz;
  v_current_started_at timestamptz;
  v_is_fallback boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL
     OR NEW.turn_status <> 'finalized'
     OR NEW.role NOT IN ('child', 'k')
     OR btrim(NEW.content) = '' THEN
    RETURN NEW;
  END IF;

  SELECT s.child_id
  INTO v_child_id
  FROM public.chat_sessions s
  WHERE s.id = NEW.session_id
    AND s.deleted_at IS NULL;

  IF v_child_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cp.relationship_started_at, cp.relationship_started_at_is_fallback
  INTO v_current_started_at, v_is_fallback
  FROM public.child_profiles cp
  WHERE cp.id = v_child_id;

  IF v_current_started_at IS NOT NULL AND NOT v_is_fallback THEN
    RETURN NEW;
  END IF;

  v_started_at := public.find_first_relationship_turn_at(v_child_id);
  IF v_started_at IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.child_profiles
  SET relationship_started_at = v_started_at,
      relationship_started_at_is_fallback = false
  WHERE id = v_child_id
    AND (relationship_started_at IS NULL OR relationship_started_at_is_fallback);

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_relationship_started_at_from_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_capture_relationship_started_at ON public.chat_messages;
CREATE TRIGGER trg_capture_relationship_started_at
AFTER INSERT OR UPDATE OF role, content, display_sequence, turn_status, deleted_at
ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.capture_relationship_started_at_from_message();

CREATE OR REPLACE FUNCTION public.capture_relationship_started_at_from_mission_turn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_child_id uuid;
  v_started_at timestamptz;
  v_current_started_at timestamptz;
  v_is_fallback boolean;
BEGIN
  SELECT s.child_id
  INTO v_child_id
  FROM public.chat_sessions s
  WHERE s.id = NEW.session_id
    AND s.session_type = 'mission'
    AND s.deleted_at IS NULL;

  IF v_child_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cp.relationship_started_at, cp.relationship_started_at_is_fallback
  INTO v_current_started_at, v_is_fallback
  FROM public.child_profiles cp
  WHERE cp.id = v_child_id;

  IF v_current_started_at IS NOT NULL AND NOT v_is_fallback THEN
    RETURN NEW;
  END IF;

  v_started_at := public.find_first_relationship_turn_at(v_child_id);
  IF v_started_at IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.child_profiles
  SET relationship_started_at = v_started_at,
      relationship_started_at_is_fallback = false
  WHERE id = v_child_id
    AND (relationship_started_at IS NULL OR relationship_started_at_is_fallback);

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_relationship_started_at_from_mission_turn() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_capture_relationship_started_at_from_mission_turn ON public.mission_turns;
CREATE TRIGGER trg_capture_relationship_started_at_from_mission_turn
AFTER UPDATE OF status ON public.mission_turns
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM 'FINALIZED' AND NEW.status = 'FINALIZED')
EXECUTE FUNCTION public.capture_relationship_started_at_from_mission_turn();

CREATE OR REPLACE FUNCTION public.protect_mission_turn_session_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RAISE EXCEPTION 'mission_turn_session_id_is_immutable' USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_mission_turn_session_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_mission_turn_session_id ON public.mission_turns;
CREATE TRIGGER trg_protect_mission_turn_session_id
BEFORE UPDATE OF session_id ON public.mission_turns
FOR EACH ROW
EXECUTE FUNCTION public.protect_mission_turn_session_id();

CREATE OR REPLACE FUNCTION public.protect_relationship_started_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (
      NEW.relationship_started_at IS NOT NULL
      OR NEW.relationship_started_at_is_fallback IS DISTINCT FROM false
    ) AND auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'relationship_started_at_service_role_only' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF (
    NEW.relationship_started_at IS DISTINCT FROM OLD.relationship_started_at
    OR NEW.relationship_started_at_is_fallback IS DISTINCT FROM OLD.relationship_started_at_is_fallback
  ) AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'relationship_started_at_service_role_only' USING ERRCODE = '42501';
  END IF;

  IF OLD.relationship_started_at IS NOT NULL
     AND NOT OLD.relationship_started_at_is_fallback
     AND (
       NEW.relationship_started_at IS DISTINCT FROM OLD.relationship_started_at
       OR NEW.relationship_started_at_is_fallback IS DISTINCT FROM false
     ) THEN
    RAISE EXCEPTION 'relationship_started_at_is_immutable' USING ERRCODE = '22000';
  END IF;

  IF OLD.relationship_started_at_is_fallback
     AND NOT NEW.relationship_started_at_is_fallback
     AND NEW.relationship_started_at IS NULL THEN
    RAISE EXCEPTION 'relationship_started_at_required_when_fallback_cleared' USING ERRCODE = '22000';
  END IF;

  IF OLD.relationship_started_at_is_fallback
     AND NEW.relationship_started_at_is_fallback
     AND NEW.relationship_started_at IS DISTINCT FROM OLD.relationship_started_at THEN
    RAISE EXCEPTION 'relationship_started_at_fallback_is_immutable' USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_relationship_started_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_relationship_started_at ON public.child_profiles;
CREATE TRIGGER trg_protect_relationship_started_at
BEFORE UPDATE OF relationship_started_at, relationship_started_at_is_fallback
ON public.child_profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_relationship_started_at();

DROP TRIGGER IF EXISTS trg_protect_relationship_started_at_on_insert ON public.child_profiles;
CREATE TRIGGER trg_protect_relationship_started_at_on_insert
BEFORE INSERT ON public.child_profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_relationship_started_at();
