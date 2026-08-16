-- 075 Relationship Engine V1: 최소 스키마 확장 (Phase 1)
--
-- 근거 문서: docs/plans/plan-075-relationship-engine-v1-minimal-schema.md
-- 주의: 실행 전 대표 승인 필요. 이 파일 생성만으로 적용되지 않는다.
--
-- 스키마 원칙:
-- - 신규 테이블 0개 (개념 저장 구조 7개를 기존 3개 테이블 + TS/env config로 흡수)
-- - 확장 대상 3개:
--   1) public.child_profiles (relationship_effective_stage 등 3개 상태 컬럼)
--      * relationship_started_at 및 _is_fallback은 이미 존재하므로 재사용/중복 생성 금지
--   2) public.chat_sessions (relationship_context JSONB write-once 스냅샷 + 보호 트리거)
--   3) public.behavior_events (event_key 컬럼 + feature/relationship CHECK + partial unique index)

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) child_relationship_state -> child_profiles 1:1 확장
-- -----------------------------------------------------------------------------
ALTER TABLE public.child_profiles
  ADD COLUMN IF NOT EXISTS relationship_effective_stage text,
  ADD COLUMN IF NOT EXISTS relationship_effective_stage_rule_version text,
  ADD COLUMN IF NOT EXISTS relationship_stage_advanced_at timestamptz;

COMMENT ON COLUMN public.child_profiles.relationship_effective_stage IS
  '아이의 현재 관계 확정 단계(W1~W4). W1은 baseline이며 W2 이상은 규칙 충족 시 전진.';
COMMENT ON COLUMN public.child_profiles.relationship_effective_stage_rule_version IS
  'relationship_effective_stage가 승격될 때 적용된 규칙 버전(예: v1).';
COMMENT ON COLUMN public.child_profiles.relationship_stage_advanced_at IS
  'relationship_effective_stage가 마지막으로 승격된 시각.';

ALTER TABLE public.child_profiles
  DROP CONSTRAINT IF EXISTS child_profiles_relationship_effective_stage_check,
  DROP CONSTRAINT IF EXISTS child_profiles_relationship_state_completeness_check;

ALTER TABLE public.child_profiles
  ADD CONSTRAINT child_profiles_relationship_effective_stage_check
  CHECK (
    relationship_effective_stage IS NULL
    OR relationship_effective_stage IN ('W1', 'W2', 'W3', 'W4')
  ),
  ADD CONSTRAINT child_profiles_relationship_state_completeness_check
  CHECK (
    (relationship_effective_stage IS NULL
      AND relationship_effective_stage_rule_version IS NULL
      AND relationship_stage_advanced_at IS NULL)
    OR
    (relationship_effective_stage IS NOT NULL
      AND relationship_effective_stage_rule_version IS NOT NULL
      AND relationship_stage_advanced_at IS NOT NULL)
  );

-- child_id PK 조회에 함께 읽으므로 새 index 불필요.
-- count/memory/event 집계값은 이 테이블에 저장하지 않는다.

-- -----------------------------------------------------------------------------
-- 2) relationship_session_context -> chat_sessions 1:1 JSONB 확장
-- -----------------------------------------------------------------------------
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS relationship_context jsonb;

COMMENT ON COLUMN public.chat_sessions.relationship_context IS
  '세션 시작 시 확정된 관계 스냅샷(W1~W4, Scenario ID/version, Memory refs 등). service_role write-once.';

ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_relationship_context_check;

ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_relationship_context_check
  CHECK (
    relationship_context IS NULL
    OR (
      jsonb_typeof(relationship_context) = 'object'
      AND relationship_context ?& ARRAY[
        'schema_version', 'calendar_stage', 'calendar_stage_source', 'effective_stage',
        'stage_rule_version', 'scenario_id', 'scenario_version',
        'grade', 'grade_strategy_version', 'memory_refs', 'entry_source', 'frozen_at'
      ]
      AND COALESCE(
        relationship_context->>'schema_version' = '1'
        AND relationship_context->>'calendar_stage' IN ('W1', 'W2', 'W3', 'W4')
        AND relationship_context->>'calendar_stage_source' IN (
          'relationship_started_at', 'provisional_null', 'provisional_fallback'
        )
        AND relationship_context->>'effective_stage' IN ('W1', 'W2', 'W3', 'W4')
        AND array_position(
          ARRAY['W1', 'W2', 'W3', 'W4'],
          relationship_context->>'effective_stage'
        ) <= array_position(
          ARRAY['W1', 'W2', 'W3', 'W4'],
          relationship_context->>'calendar_stage'
        )
        AND jsonb_typeof(relationship_context->'grade') = 'number'
        AND relationship_context->>'grade' IN ('1', '2', '3', '4', '5', '6')
        AND jsonb_typeof(relationship_context->'stage_rule_version') = 'string'
        AND length(relationship_context->>'stage_rule_version') > 0
        AND jsonb_typeof(relationship_context->'scenario_id') = 'string'
        AND length(relationship_context->>'scenario_id') > 0
        -- ||와 ->>는 우선순위가 같아 왼쪽부터 묶인다. 괄호가 없으면
        -- ('G' || relationship_context)로 해석돼 text||jsonb가 되고
        -- 'G'를 JSON으로 파싱하려다 22P02로 실패한다(2026-08-16 Dev 실측).
        AND relationship_context->>'scenario_id' =
          'G' || (relationship_context->>'grade') || '_' ||
          CASE relationship_context->>'effective_stage'
            WHEN 'W1' THEN 'MEET'
            WHEN 'W2' THEN 'REMEMBER'
            WHEN 'W3' THEN 'SHARED_HISTORY'
            WHEN 'W4' THEN 'VOLUNTARY_RETURN'
          END
        AND jsonb_typeof(relationship_context->'scenario_version') = 'string'
        AND length(relationship_context->>'scenario_version') > 0
        AND relationship_context->>'scenario_version' ~ '^v[1-9][0-9]*$'
        AND jsonb_typeof(relationship_context->'grade_strategy_version') = 'string'
        AND length(relationship_context->>'grade_strategy_version') > 0
        AND jsonb_typeof(relationship_context->'frozen_at') = 'string'
        AND length(relationship_context->>'frozen_at') > 0
        AND jsonb_typeof(relationship_context->'memory_refs') = 'array'
        AND relationship_context->>'entry_source' IN (
          'direct_open', 'notification', 'reward', 'play', 'parent_trigger', 'unknown'
        )
        AND (
          relationship_context->>'calendar_stage_source' = 'relationship_started_at'
          OR (
            relationship_context->>'calendar_stage' = 'W1'
            AND relationship_context->>'effective_stage' = 'W1'
          )
        ),
        false
      )
    )
  );

CREATE OR REPLACE FUNCTION public.protect_chat_session_relationship_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.relationship_context IS NOT NULL
       AND auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'relationship_context_service_role_only' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- 같은 JSONB 재시도는 no-op으로 허용한다.
  IF NEW.relationship_context IS NOT DISTINCT FROM OLD.relationship_context THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'relationship_context_service_role_only' USING ERRCODE = '42501';
  END IF;

  -- NULL -> snapshot 최초 1회 외 수정/삭제는 service_role도 금지한다.
  IF OLD.relationship_context IS NOT NULL THEN
    RAISE EXCEPTION 'relationship_context_is_write_once' USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_chat_session_relationship_context()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_chat_session_relationship_context
  ON public.chat_sessions;
CREATE TRIGGER trg_protect_chat_session_relationship_context
BEFORE UPDATE OF relationship_context ON public.chat_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_chat_session_relationship_context();

DROP TRIGGER IF EXISTS trg_protect_chat_session_relationship_context_on_insert
  ON public.chat_sessions;
CREATE TRIGGER trg_protect_chat_session_relationship_context_on_insert
BEFORE INSERT ON public.chat_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_chat_session_relationship_context();

-- 세션 PK로만 조회하고 세션당 최대 1개이므로 JSONB GIN/expression index 불필요.
-- calendar_stage_source가 provisional_*이면 calendar_stage/effective_stage는 W1만 허용.
-- memory_refs 원소 계약: {"source":"memory_facts"|"child_memory","id":"uuid"}
-- Memory content/evidence/prompt 원문은 relationship_context에 저장 금지.

-- -----------------------------------------------------------------------------
-- 3) relationship_events -> behavior_events 확장
-- -----------------------------------------------------------------------------
ALTER TABLE public.behavior_events
  ADD COLUMN IF NOT EXISTS event_key text;

COMMENT ON COLUMN public.behavior_events.event_key IS
  '논리적 멱등성 키(예: relationship:memory_used:<child_id>:<logical_id>). partial unique index로 중복 삽입 방지.';

ALTER TABLE public.behavior_events
  DROP CONSTRAINT IF EXISTS behavior_events_feature_check,
  DROP CONSTRAINT IF EXISTS behavior_events_relationship_contract_check;

ALTER TABLE public.behavior_events
  ADD CONSTRAINT behavior_events_feature_check CHECK (feature IN (
    'auth', 'home', 'mission', 'freechat', 'play', 'daily_report',
    'weekly_report', 'monthly_report', 'conversation_topic',
    'child_management', 'guardian_settings', 'subscription', 'app_session',
    -- pwa_update는 078/102 PWA 업데이트 텔레메트리가 이미 쓰는 값이다.
    -- 빼면 기존 행(2026-08-16 실측 Dev 54건 / Prod 25건)이 CHECK를 위반해
    -- migration 자체가 실패한다.
    'pwa_update',
    'relationship'
  )),
  ADD CONSTRAINT behavior_events_relationship_contract_check CHECK (
    feature <> 'relationship'
    OR (
      child_id IS NOT NULL
      AND event_key IS NOT NULL
      AND event_name IN (
        'memory_used', 'memory_acknowledged', 'child_referenced_past',
        'direct_open', 'notification_entry',
        'reward_entry', 'play_to_chat', 'returned_after_gap'
      )
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS behavior_events_event_key_uq
  ON public.behavior_events(event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS behavior_events_idempotent_child_name_time_idx
  ON public.behavior_events(child_id, event_name, occurred_at DESC)
  WHERE event_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4) GRANT 규약
-- -----------------------------------------------------------------------------
-- 기존 RLS 유지 + 프로젝트 GRANT 규약 재확인.
GRANT ALL ON public.child_profiles TO anon, authenticated;
GRANT ALL ON public.chat_sessions TO anon, authenticated;
GRANT ALL ON public.behavior_events TO anon, authenticated;
GRANT ALL ON public.behavior_events TO service_role;

COMMIT;
