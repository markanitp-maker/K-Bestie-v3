-- Supabase Security Advisor `rls_disabled_in_public` 핫픽스 (2/2) — public.client_version_events.
--
-- **Production 전용이다.** 이 테이블은 Dev 에 존재하지 않는다(2026-08-19 실측).
-- 없는 환경에 새로 만들지 않는다 — 이번 작업의 목적은 보안 설정 교정이지 스키마 확장이 아니다.
-- Dev 에 이 파일을 적용하면 "relation does not exist" 로 실패하는 것이 올바른 동작이다.
--
-- 기록 경로는 app/api/client-version/routeHandler.ts:485 하나뿐이고
-- createServiceClient()(service_role)를 쓴다. 브라우저 직접 접근은 없다.
-- 그래서 turn_timing_events 와 같은 이유로 policy 를 만들지 않는다.
--
-- 참고: Production 실측상 이 테이블에는 anon/authenticated 테이블 권한이 이미 없었다
-- (postgres, service_role 만 보유). 20260722085248 의 GRANT 가 이후 어딘가에서 정리된 것으로
-- 보인다. REVOKE 는 그래도 남겨 둔다 — 이미 없는 권한을 회수하는 것은 무해하고,
-- 환경이 어긋나 있을 때 같은 상태로 수렴시킨다.

ALTER TABLE public.client_version_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.client_version_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.client_version_events_id_seq FROM anon, authenticated;

COMMENT ON TABLE public.client_version_events IS
  '클라이언트 버전 기록. 서버 service_role 전용 — RLS on, policy 없음, anon/authenticated 권한 없음.';
