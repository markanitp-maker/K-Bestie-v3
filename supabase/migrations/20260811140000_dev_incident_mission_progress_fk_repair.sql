-- 2026-08-11 Dev P0 장애 복구: mission_progress FK 제약 복구.
-- Production DB는 대상 아님, Dev(mkrsaaedxqrcrktapaus) 전용.
--
-- 근거 (Vercel 실시간 런타임 에러 로그 + pg_constraint 직접 대조로 확인, 추측 아님):
-- app/api/mission/start/route.ts가 `.select("id, mission_progress!inner(...))")`로
-- chat_sessions↔mission_progress를 PostgREST 임베디드 조인하는데, Dev의 mission_progress에는
-- FK 제약이 단 하나도 없어(Production은 child_id/session_id 2개 FK 보유) PostgREST 스키마
-- 캐시가 관계를 찾지 못해 PGRST200("Could not find a relationship")으로 미션 시작이 계속
-- 실패했다(2026-08-11 08:16~08:39 KST, 같은 사용자 1명·7회 연속 재현).
--
-- 기존 mission_progress 46행 전부가 child_id/session_id 둘 다 참조 대상이 존재하지 않는
-- 상태(과거 Dev 초기화 사고 이전 데이터로 추정)라 즉시 검증하는 FK를 걸면 전부 위반된다.
-- 데이터 손실 없이 진행하라는 지시에 따라 기존 행은 그대로 두고(삭제하지 않음),
-- NOT VALID로 추가해 신규 행부터 즉시 PostgREST가 관계를 인식하게 한다 — 이 코드베이스의
-- Production 마이그레이션(chat_sessions_mission_phase_check 등)에서도 이미 쓰인 패턴이다.

BEGIN;

ALTER TABLE public.mission_progress DROP CONSTRAINT IF EXISTS mission_progress_child_id_fkey;
ALTER TABLE public.mission_progress DROP CONSTRAINT IF EXISTS mission_progress_session_id_fkey;

ALTER TABLE public.mission_progress
  ADD CONSTRAINT mission_progress_child_id_fkey
  FOREIGN KEY (child_id) REFERENCES public.child_profiles(id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.mission_progress
  ADD CONSTRAINT mission_progress_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id)
  NOT VALID;

-- PostgREST 스키마 캐시 즉시 갱신 (Supabase는 DDL 이벤트 트리거로 보통 자동 반영되지만,
-- 명시적으로 알려 지연 없이 반영되게 한다)
NOTIFY pgrst, 'reload schema';

COMMIT;
