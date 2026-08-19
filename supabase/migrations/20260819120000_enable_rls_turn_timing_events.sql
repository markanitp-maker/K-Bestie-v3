-- Supabase Security Advisor `rls_disabled_in_public` 핫픽스 (1/2) — public.turn_timing_events.
-- Dev·Production 양쪽에 존재한다. 다른 테이블은 건드리지 않는다.
--
-- [왜 policy 를 만들지 않는가]
-- 이 테이블은 서버 Route Handler 가 createServiceClient()(service_role)로만 기록한다.
-- 실측(2026-08-19): app/api/mission/{answer-lean,respond,respond-lean,stt,timing}/route.ts,
-- app/api/voice/tts/route.ts — 전부 createServiceClient(). 브라우저에서 직접 읽거나 쓰는
-- 경로는 없다(client 컴포넌트의 유일한 언급은 hooks/useVoiceChat.ts 의 주석이다).
-- service_role 은 BYPASSRLS 라 policy 없이 그대로 동작한다. anon/authenticated 에게는
-- 아무 문도 열어 주지 않는 것이 이 구조에 맞는 최소 상태다.
--
-- [왜 GRANT 도 회수하는가]
-- RLS 만 켜면 Advisor 경고는 사라지지만 20260730010000 이 준
-- `GRANT ALL ON turn_timing_events TO anon, authenticated` 는 그대로 남는다.
-- 권한과 정책이 어긋난 상태를 남기지 않도록 실제로 쓰이지 않는 권한을 함께 회수한다.
-- REVOKE ALL PRIVILEGES 는 SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 를
-- 한 번에 회수한다. 시퀀스 권한도 같이 회수한다 — anon INSERT 를 지원하려고 준 것이라
-- 테이블 권한이 사라지면 존재 이유가 없다.

ALTER TABLE public.turn_timing_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.turn_timing_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.turn_timing_events_id_seq FROM anon, authenticated;

COMMENT ON TABLE public.turn_timing_events IS
  '턴 지연 계측. 서버 service_role 전용 — RLS on, policy 없음, anon/authenticated 권한 없음.';
