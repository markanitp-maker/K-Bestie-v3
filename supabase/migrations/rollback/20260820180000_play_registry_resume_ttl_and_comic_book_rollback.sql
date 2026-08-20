-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 20260820180000_play_registry_resume_ttl_and_comic_book.sql 에 대한 롤백

-- 방어적 체크: exchange_play_execution_ticket 이 아직 resume_ttl_hours 를 참조하면
-- 컬럼을 지우는 순간 티켓 교환이 전부 깨진다. 마이그레이션 B 를 먼저 롤백해야 한다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'exchange_play_execution_ticket'
      AND pg_get_functiondef(p.oid) LIKE '%resume_ttl_hours%'
  ) THEN
    RAISE EXCEPTION 'exchange_play_execution_ticket 이 아직 resume_ttl_hours 를 참조한다. 마이그레이션 B 를 먼저 롤백하라.';
  END IF;
END $$;

-- 방어적 체크: comic_book 세션 이력이 있으면 레지스트리 행을 지우지 않는다
-- (play_execution_tickets.play_id FK 및 운영 이력 보존).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM k_play_sessions WHERE play_type = 'comic_book') THEN
    RAISE NOTICE 'comic_book 세션 이력이 존재하여 레지스트리 행은 유지한다(비활성화만).';
    UPDATE play_registry SET is_visible = false, is_active = false WHERE play_id = 'comic_book';
  ELSE
    DELETE FROM play_registry WHERE play_id = 'comic_book';
  END IF;
END $$;

ALTER TABLE play_registry DROP COLUMN IF EXISTS resume_ttl_hours;
