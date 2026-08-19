-- 요청서 013 「케이↔성장정보 연동 v1」 — 아이 발화에서 얻은 키·몸무게 후보값.
--
-- [설계 근거]
-- 1. 아이가 말한 값은 공식 기록이 아니다. growth_measurements 에 바로 넣지 않고 여기 쌓았다가
--    부모가 [반영] 을 눌렀을 때만 공식 기록으로 옮긴다(§3-6, §5-1). 공식 Source of Truth 는
--    계속 growth_measurements 하나다(§3-15).
-- 2. 아이 대화 원문을 여기 복제하지 않는다. chat_messages 로 되짚을 수 있는 참조만 둔다(§3-3).
--    raw_value_text 는 아이가 말한 숫자 표현("142센티") 만 담는 짧은 조각이다 — 부모가
--    "무슨 말을 듣고 만든 후보인지" 확인할 최소 정보이며 문장 전체가 아니다.
-- 3. RLS 는 성장정보 v1 과 같다 — owner_parent / parent 전용. 아이 role 은 SELECT 도 막는다(§3-16).
--    후보를 만드는 쪽(대화 서버)은 service_role 로 쓴다.
-- 4. 값 범위 CHECK 는 growth_measurements 와 같은 넓은 범위다. 여기서 "건강 판정"을 하지 않는다.
-- 5. 중복 후보 방지는 부분 유니크 인덱스로 강제한다(§3-12). 같은 아이·같은 종류·같은 값이
--    pending 으로 두 번 쌓이지 않는다. 부모가 처리(confirmed/dismissed)한 뒤에는 같은 값이
--    다시 올라올 수 있어야 하므로 status='pending' 인 행에만 건다.

CREATE TABLE IF NOT EXISTS public.growth_measurement_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  measurement_type TEXT NOT NULL,
  value NUMERIC(4,1) NOT NULL,
  unit TEXT NOT NULL,
  confidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- 어떤 대화에서 나왔는지. 원문 대신 참조만 남긴다(§3-3, §3-17).
  source_type TEXT NOT NULL,
  source_session_id UUID NULL,
  source_message_id TEXT NULL,
  /** 아이가 말한 숫자 표현 조각. 문장 전체가 아니다. */
  raw_value_text TEXT NULL,
  spoken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  /** 부모 승인으로 만들어진 공식 기록. 감사 추적용(§3-17). */
  confirmed_measurement_id UUID NULL REFERENCES public.growth_measurements(id) ON DELETE SET NULL,
  /** 부모가 값을 고쳐서 반영한 경우의 최종값. 원본 value 는 그대로 둔다(§6-5). */
  confirmed_value NUMERIC(4,1) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT growth_candidates_type_check
    CHECK (measurement_type IN ('height', 'weight')),
  CONSTRAINT growth_candidates_unit_check
    CHECK (unit IN ('cm', 'kg')),
  CONSTRAINT growth_candidates_unit_matches_type
    CHECK ((measurement_type = 'height' AND unit = 'cm')
        OR (measurement_type = 'weight' AND unit = 'kg')),
  CONSTRAINT growth_candidates_confidence_check
    CHECK (confidence IN ('high', 'low')),
  CONSTRAINT growth_candidates_status_check
    CHECK (status IN ('pending', 'confirmed', 'dismissed', 'expired')),
  CONSTRAINT growth_candidates_source_type_check
    CHECK (source_type IN ('child_utterance_mission', 'child_utterance_free_chat')),
  CONSTRAINT growth_candidates_height_range
    CHECK (measurement_type <> 'height' OR (value >= 30 AND value <= 250)),
  CONSTRAINT growth_candidates_weight_range
    CHECK (measurement_type <> 'weight' OR (value >= 2 AND value <= 200)),
  CONSTRAINT growth_candidates_reviewed_consistency
    CHECK ((status = 'pending' AND reviewed_at IS NULL)
        OR (status <> 'pending'))
);

COMMENT ON TABLE public.growth_measurement_candidates IS
  '아이 발화에서 추출한 키·몸무게 후보값. 부모 승인 전에는 공식 성장기록이 아니다. 요청서 013';
COMMENT ON COLUMN public.growth_measurement_candidates.confidence IS
  'high = 아이가 명확히 말한 값, low = 추측·불확실 표현. low 는 자동 반영 대상이 아니다(§3-4).';
COMMENT ON COLUMN public.growth_measurement_candidates.raw_value_text IS
  '아이가 말한 숫자 표현 조각만 담는다. 대화 문장 전체를 복제하지 않는다(§3-3).';

-- 부모 화면은 pending 만 최신순으로 읽는다.
CREATE INDEX IF NOT EXISTS growth_candidates_child_status_idx
  ON public.growth_measurement_candidates (child_id, status, spoken_at DESC);

-- §3-12 중복 후보 방지. 같은 값이 pending 으로 두 번 쌓이지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS growth_candidates_pending_unique
  ON public.growth_measurement_candidates (child_id, measurement_type, value)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_growth_candidates_updated_at ON public.growth_measurement_candidates;
CREATE TRIGGER trg_growth_candidates_updated_at
  BEFORE UPDATE ON public.growth_measurement_candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_growth_updated_at();

-- ── growth_measurements.source 확장 (§3-7) ────────────────────
-- 부모가 아이 발화 후보를 승인해 만든 기록은 부모 직접 입력과 구분한다.
-- 공식 측정값으로 확정하는 주체는 여전히 부모다 — 그래서 parent_ 접두어를 유지한다.
ALTER TABLE public.growth_measurements
  DROP CONSTRAINT IF EXISTS growth_measurements_source_check;
ALTER TABLE public.growth_measurements
  ADD CONSTRAINT growth_measurements_source_check
  CHECK (source IN ('parent_manual', 'parent_confirmed_child_report'));

COMMENT ON COLUMN public.growth_measurements.source IS
  'parent_manual = 부모 직접 입력. parent_confirmed_child_report = 아이가 말한 값을 부모가 확인해 반영. 요청서 013';

-- ── RLS: owner_parent / parent 전용 (성장정보 v1 과 동일) ──────
ALTER TABLE public.growth_measurement_candidates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.growth_measurement_candidates TO anon, authenticated;

DROP POLICY IF EXISTS "growth_candidates_parent_access" ON public.growth_measurement_candidates;
CREATE POLICY "growth_candidates_parent_access"
  ON public.growth_measurement_candidates FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.child_profiles cp
      JOIN public.family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = growth_measurement_candidates.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
        AND fm.deleted_at IS NULL
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.child_profiles cp
      JOIN public.family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = growth_measurement_candidates.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
        AND fm.deleted_at IS NULL
    )
  );
