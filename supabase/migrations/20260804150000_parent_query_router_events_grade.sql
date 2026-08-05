-- requests/request-parent-query-router-grade{1,2,3,5,6}-v1.md — 부모 질문 라우터가 4학년
-- 외 5개 학년으로 확장되면서, 관리자 통계(§14)가 학년별로 나눠 봐야 의미가 있다.
-- parent_query_router_events에 grade 컬럼을 추가한다(policy_version 문자열 파싱 대신
-- 명시적 컬럼으로 — 파싱 실패 위험 없음).

ALTER TABLE public.parent_query_router_events
  ADD COLUMN IF NOT EXISTS grade smallint;

CREATE INDEX IF NOT EXISTS idx_pqr_events_grade ON public.parent_query_router_events(grade);
