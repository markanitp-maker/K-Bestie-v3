-- 007 보정: Pending Play Proposal의 세션 단위 영속화
-- 프로세스 메모리 Map 대신 chat_sessions.pending_play_proposal JSONB에 저장해
-- Vercel 서버리스 다중 인스턴스 환경에서도 세션 턴 간 놀이 제안 상태를 보존한다.
-- TTL(10분)과 정리 시점(Topic Shift, 거절, Skill 시작, 세션 종료)은 동일하게 유지된다.

ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS pending_play_proposal jsonb;

COMMENT ON COLUMN public.chat_sessions.pending_play_proposal IS
  '해당 대화 세션의 short-lived 놀이 제안 상태(제안 스킬 목록, 제안 시각, 제안 주체, 선택 대기 여부 등). null 또는 PendingPlayProposal JSON';
