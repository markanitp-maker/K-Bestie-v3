-- requests/065-production-business-date-null-recovery-and-prevention.md
-- 축 1: 2026-08-03에 생성된 business_date IS NULL 세션만 KST 기준으로 복구.
-- 다른 날짜의 기존 NULL 세션(2026-07-29~08-02, 앱 코드 수정 이전부터 존재)은
-- 이번 요청의 명시 범위 밖이라 건드리지 않는다.
UPDATE chat_sessions
SET business_date = (started_at AT TIME ZONE 'Asia/Seoul')::date
WHERE business_date IS NULL
  AND (started_at AT TIME ZONE 'Asia/Seoul')::date = '2026-08-03';

-- 축 2: BEFORE INSERT/UPDATE 트리거 — 애플리케이션 코드가 business_date를 누락해도
-- started_at(없으면 NOW())의 KST 날짜로 자동 채운다. 이미 값이 있으면 절대 덮어쓰지
-- 않는다(§13 "기존 정상 날짜 덮어쓰기 금지").
CREATE OR REPLACE FUNCTION public.chat_sessions_fill_business_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.business_date IS NULL THEN
    NEW.business_date := (COALESCE(NEW.started_at, now()) AT TIME ZONE 'Asia/Seoul')::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_sessions_fill_business_date ON chat_sessions;
CREATE TRIGGER trg_chat_sessions_fill_business_date
  BEFORE INSERT OR UPDATE ON chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_sessions_fill_business_date();

-- Rollback:
-- DROP TRIGGER IF EXISTS trg_chat_sessions_fill_business_date ON chat_sessions;
-- DROP FUNCTION IF EXISTS public.chat_sessions_fill_business_date();
-- (2026-08-03 백필 UPDATE는 되돌릴 필요가 없다 — 원래도 NULL이던 값을 정확한 KST
--  날짜로 채운 것뿐이며, 요청서 §6 범위를 벗어나지 않았다.)

-- 참고: chat_sessions.business_date NOT NULL 제약은 이번 마이그레이션에 포함하지
-- 않는다. 2026-08-03 이전(07-29~08-02)에도 이미 26건의 NULL 세션이 존재하는데,
-- 이번 요청은 "2026-08-03에 생성된 세션만" 복구하도록 명시적으로 범위를 제한했다
-- (§6). 그 26건까지 일괄 백필하는 것은 이 요청의 승인 범위를 벗어나므로, 위 트리거로
-- 신규 발생을 원천 차단한 뒤 NOT NULL 전환은 별도 요청으로 판단받는다.
