-- 075 Relationship Engine V1 Phase 1: additive schema only.
-- grade must use only the normalized '1'-'6' strings produced by
-- lib/persona/gradeAdaptivePersona.ts parseGrade + Math.min(x, 6).
-- Never persist the free-form child_profiles.grade value directly.
-- calendar_stage keeps the W1-W4 calendar labels, while effective_stage and
-- stage_key use the semantic MEET-TO-VOLUNTARY_RETURN labels. stage_order is
-- the canonical mapping between those two representations.

CREATE TABLE IF NOT EXISTS public.relationship_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_key text NOT NULL UNIQUE
    CHECK (stage_key IN ('MEET', 'REMEMBER', 'SHARED_HISTORY', 'VOLUNTARY_RETURN')),
  stage_order integer NOT NULL UNIQUE CHECK (stage_order BETWEEN 1 AND 4),
  name text NOT NULL,
  description text NOT NULL,
  primary_goal text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.grade_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade text NOT NULL CHECK (grade IN ('1', '2', '3', '4', '5', '6')),
  version integer NOT NULL CHECK (version > 0),
  strategy jsonb NOT NULL,
  response_style jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grade_strategies_id_version_key UNIQUE (id, version),
  CONSTRAINT grade_strategies_grade_version_key UNIQUE (grade, version)
);

CREATE TABLE IF NOT EXISTS public.relationship_stage_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_key text NOT NULL
    REFERENCES public.relationship_stages(stage_key) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  min_conversation_count integer NOT NULL CHECK (min_conversation_count >= 0),
  min_conversation_days integer NOT NULL CHECK (min_conversation_days >= 0),
  min_usable_memory_count integer NOT NULL CHECK (min_usable_memory_count >= 0),
  min_shared_memory_count integer NOT NULL CHECK (min_shared_memory_count >= 0),
  min_relationship_event_count integer NOT NULL CHECK (min_relationship_event_count >= 0),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_stage_rules_stage_version_key UNIQUE (stage_key, version)
);

CREATE TABLE IF NOT EXISTS public.relationship_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_key text NOT NULL UNIQUE,
  grade text NOT NULL CHECK (grade IN ('1', '2', '3', '4', '5', '6')),
  stage_key text NOT NULL
    REFERENCES public.relationship_stages(stage_key) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  active boolean NOT NULL DEFAULT false,
  primary_goal text NOT NULL,
  secondary_goal text NOT NULL,
  strategy jsonb NOT NULL,
  recommended_memory_types jsonb NOT NULL,
  forbidden_patterns jsonb NOT NULL,
  response_style jsonb NOT NULL,
  expected_events jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_scenarios_id_version_key UNIQUE (id, version),
  CONSTRAINT relationship_scenarios_grade_stage_version_key
    UNIQUE (grade, stage_key, version)
);

CREATE TABLE IF NOT EXISTS public.child_relationship_state (
  child_id uuid PRIMARY KEY
    REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  calendar_stage text NOT NULL CHECK (calendar_stage IN ('W1', 'W2', 'W3', 'W4')),
  effective_stage text NOT NULL
    REFERENCES public.relationship_stages(stage_key) ON DELETE RESTRICT,
  effective_stage_started_at timestamptz NOT NULL,
  last_evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.relationship_session_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE
    REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  child_id uuid NOT NULL
    REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  calendar_stage text NOT NULL CHECK (calendar_stage IN ('W1', 'W2', 'W3', 'W4')),
  effective_stage text NOT NULL
    REFERENCES public.relationship_stages(stage_key) ON DELETE RESTRICT,
  scenario_id uuid NOT NULL,
  scenario_version integer NOT NULL CHECK (scenario_version > 0),
  grade_strategy_id uuid NOT NULL,
  grade_strategy_version integer NOT NULL CHECK (grade_strategy_version > 0),
  memory_fact_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  entry_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_session_context_scenario_version_fkey
    FOREIGN KEY (scenario_id, scenario_version)
    REFERENCES public.relationship_scenarios(id, version) ON DELETE RESTRICT,
  CONSTRAINT relationship_session_context_grade_strategy_version_fkey
    FOREIGN KEY (grade_strategy_id, grade_strategy_version)
    REFERENCES public.grade_strategies(id, version) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.relationship_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  child_id uuid NOT NULL
    REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  session_id uuid
    REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  scenario_id uuid
    REFERENCES public.relationship_scenarios(id) ON DELETE SET NULL,
  scenario_version integer CHECK (scenario_version IS NULL OR scenario_version > 0),
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_events_child_event_key UNIQUE (child_id, event_key)
);

COMMENT ON TABLE public.relationship_stages IS
  'Relationship Engine의 semantic stage 정의와 W1-W4 순서 매핑.';
COMMENT ON TABLE public.grade_strategies IS
  '정규화된 학년 1-6별 버전 관리 대화 전략.';
COMMENT ON TABLE public.relationship_stage_rules IS
  'semantic relationship stage 진입 조건의 버전 관리 설정.';
COMMENT ON TABLE public.relationship_scenarios IS
  '정규화된 학년과 semantic stage별 버전 관리 Scenario Card.';
COMMENT ON TABLE public.child_relationship_state IS
  '아이별 calendar stage 후보 상한과 실제 적용 semantic stage 상태.';
COMMENT ON TABLE public.relationship_session_context IS
  '세션 시작 시 고정된 stage, scenario, grade strategy 버전 스냅샷.';
COMMENT ON TABLE public.relationship_events IS
  '아이별 관계 진행 이벤트와 멱등성 식별자.';

COMMENT ON COLUMN public.child_relationship_state.calendar_stage IS
  '관계 시작일로 계산한 W1-W4 후보 상한선이며 effective_stage의 최대 범위.';
COMMENT ON COLUMN public.child_relationship_state.effective_stage IS
  '진입 조건 평가 후 실제 대화에 적용하는 semantic relationship stage.';
COMMENT ON COLUMN public.relationship_session_context.calendar_stage IS
  '세션 시작 시 고정한 W1-W4 후보 상한선.';
COMMENT ON COLUMN public.relationship_session_context.effective_stage IS
  '세션 시작 시 고정한 실제 적용 semantic relationship stage.';
COMMENT ON COLUMN public.relationship_events.event_key IS
  'child_id와 함께 사용하는 아이별 이벤트 멱등성 키.';

CREATE UNIQUE INDEX IF NOT EXISTS grade_strategies_one_active_per_grade
  ON public.grade_strategies (grade)
  WHERE active;

CREATE UNIQUE INDEX IF NOT EXISTS relationship_stage_rules_one_active_per_stage
  ON public.relationship_stage_rules (stage_key)
  WHERE active;

CREATE UNIQUE INDEX IF NOT EXISTS relationship_scenarios_one_active_per_grade_stage
  ON public.relationship_scenarios (grade, stage_key)
  WHERE active;

CREATE INDEX IF NOT EXISTS relationship_session_context_child_created_at_idx
  ON public.relationship_session_context (child_id, created_at DESC);

CREATE INDEX IF NOT EXISTS relationship_session_context_scenario_id_idx
  ON public.relationship_session_context (scenario_id);

CREATE INDEX IF NOT EXISTS relationship_session_context_grade_strategy_id_idx
  ON public.relationship_session_context (grade_strategy_id);

CREATE INDEX IF NOT EXISTS relationship_events_child_created_at_idx
  ON public.relationship_events (child_id, created_at DESC);

CREATE INDEX IF NOT EXISTS relationship_events_session_id_idx
  ON public.relationship_events (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS relationship_events_scenario_id_idx
  ON public.relationship_events (scenario_id);

CREATE INDEX IF NOT EXISTS child_relationship_state_effective_stage_idx
  ON public.child_relationship_state (effective_stage);

CREATE OR REPLACE FUNCTION public.set_relationship_stages_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_relationship_stages_updated_at
  ON public.relationship_stages;
CREATE TRIGGER trg_relationship_stages_updated_at
  BEFORE UPDATE ON public.relationship_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_relationship_stages_updated_at();

CREATE OR REPLACE FUNCTION public.set_grade_strategies_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grade_strategies_updated_at
  ON public.grade_strategies;
CREATE TRIGGER trg_grade_strategies_updated_at
  BEFORE UPDATE ON public.grade_strategies
  FOR EACH ROW EXECUTE FUNCTION public.set_grade_strategies_updated_at();

CREATE OR REPLACE FUNCTION public.set_relationship_stage_rules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_relationship_stage_rules_updated_at
  ON public.relationship_stage_rules;
CREATE TRIGGER trg_relationship_stage_rules_updated_at
  BEFORE UPDATE ON public.relationship_stage_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_relationship_stage_rules_updated_at();

CREATE OR REPLACE FUNCTION public.set_relationship_scenarios_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_relationship_scenarios_updated_at
  ON public.relationship_scenarios;
CREATE TRIGGER trg_relationship_scenarios_updated_at
  BEFORE UPDATE ON public.relationship_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.set_relationship_scenarios_updated_at();

CREATE OR REPLACE FUNCTION public.set_child_relationship_state_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_child_relationship_state_updated_at
  ON public.child_relationship_state;
CREATE TRIGGER trg_child_relationship_state_updated_at
  BEFORE UPDATE ON public.child_relationship_state
  FOR EACH ROW EXECUTE FUNCTION public.set_child_relationship_state_updated_at();

INSERT INTO public.relationship_stages (
  stage_key,
  stage_order,
  name,
  description,
  primary_goal
) VALUES
  ('MEET', 1, '만남', 'calendar_stage W1에 대응하는 관계 단계', '얘랑 이야기해도 괜찮네.'),
  ('REMEMBER', 2, '기억', 'calendar_stage W2에 대응하는 관계 단계', '케이가 나를 기억하고 있구나.'),
  ('SHARED_HISTORY', 3, '공유된 역사', 'calendar_stage W3에 대응하는 관계 단계', '우리 둘이 아는 이야기가 생겼다.'),
  ('VOLUNTARY_RETURN', 4, '자발적 재방문', 'calendar_stage W4에 대응하는 관계 단계', '오늘 케이한테 이야기하고 싶다.');

ALTER TABLE public.relationship_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_stage_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.child_relationship_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_session_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_events ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.relationship_stages TO anon, authenticated;
GRANT ALL ON TABLE public.grade_strategies TO anon, authenticated;
GRANT ALL ON TABLE public.relationship_stage_rules TO anon, authenticated;
GRANT ALL ON TABLE public.relationship_scenarios TO anon, authenticated;
GRANT ALL ON TABLE public.child_relationship_state TO anon, authenticated;
GRANT ALL ON TABLE public.relationship_session_context TO anon, authenticated;
GRANT ALL ON TABLE public.relationship_events TO anon, authenticated;

-- These tables are accessed only through service-role server paths. Supabase's
-- service role bypasses RLS; every RLS-bound client role is denied directly.
DROP POLICY IF EXISTS "relationship_stages_service_only"
  ON public.relationship_stages;
CREATE POLICY "relationship_stages_service_only"
  ON public.relationship_stages FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "grade_strategies_service_only"
  ON public.grade_strategies;
CREATE POLICY "grade_strategies_service_only"
  ON public.grade_strategies FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "relationship_stage_rules_service_only"
  ON public.relationship_stage_rules;
CREATE POLICY "relationship_stage_rules_service_only"
  ON public.relationship_stage_rules FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "relationship_scenarios_service_only"
  ON public.relationship_scenarios;
CREATE POLICY "relationship_scenarios_service_only"
  ON public.relationship_scenarios FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "child_relationship_state_service_only"
  ON public.child_relationship_state;
CREATE POLICY "child_relationship_state_service_only"
  ON public.child_relationship_state FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "relationship_session_context_service_only"
  ON public.relationship_session_context;
CREATE POLICY "relationship_session_context_service_only"
  ON public.relationship_session_context FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "relationship_events_service_only"
  ON public.relationship_events;
CREATE POLICY "relationship_events_service_only"
  ON public.relationship_events FOR ALL
  USING (false)
  WITH CHECK (false);
