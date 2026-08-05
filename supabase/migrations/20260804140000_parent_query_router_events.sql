-- requests/request-parent-query-router-grade4-v1.md §14 — 관리자 통계(Green/Red/Crisis
-- 판정 건수, rule_id별 건수, default Red 비율)를 계산하려면 모든 판정 이벤트가 필요하다.
-- 그런데 RED/CRISIS는 설계상 parent_questions에 행을 만들지 않는다(§7.1/§8.2 "대기열에
-- 등록하지 않는다") — 즉 기존 테이블만으로는 GREEN 판정만 보이고 Red/Crisis 비율을 전혀
-- 알 수 없다. 부모 질문 원문은 절대 저장하지 않는(§13 최소 수집, 특히 Crisis 원문은
-- 일반 로그에도 남기지 않음) 가벼운 감사 이벤트 테이블을 별도로 둔다.

CREATE TABLE IF NOT EXISTS public.parent_query_router_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  route text NOT NULL CHECK (route IN ('CRISIS', 'RED', 'GREEN', 'MULTI_QUESTION_SELECT', 'GENERATION_FAILED')),
  area text,
  rule_id text,
  confidence numeric,
  policy_version text NOT NULL,
  question_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pqr_events_child_id ON public.parent_query_router_events(child_id);
CREATE INDEX IF NOT EXISTS idx_pqr_events_route ON public.parent_query_router_events(route);
CREATE INDEX IF NOT EXISTS idx_pqr_events_created_at ON public.parent_query_router_events(created_at);

ALTER TABLE public.parent_query_router_events ENABLE ROW LEVEL SECURITY;

-- 이 테이블은 service_role(서버 API)과 관리자 조회 API에서만 접근한다. anon/authenticated
-- 직접 접근은 막는다(이 프로젝트 관례상 GRANT ALL을 쓰되, RLS로 실질 접근을 차단한다).
GRANT ALL ON public.parent_query_router_events TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'parent_query_router_events' AND policyname = 'service_role_only'
  ) THEN
    CREATE POLICY service_role_only ON public.parent_query_router_events
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
