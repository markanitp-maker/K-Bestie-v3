-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 20260820200000_game_comic_content_model.sql 에 대한 롤백

-- 방어적 체크: 진행 중 세션이 참조하는 책이 있으면 롤백하지 않는다.
-- progress_state.opaquePayload.selectedBookId 가 이 테이블의 id 를 가리킨다.
DO $$
DECLARE
  v_refs INTEGER;
BEGIN
  SELECT count(*) INTO v_refs
  FROM k_play_sessions
  WHERE play_type = 'comic_book'
    AND status = 'in_progress'
    AND progress_state -> 'opaquePayload' ->> 'selectedBookId' IS NOT NULL;

  IF v_refs > 0 THEN
    RAISE EXCEPTION '진행 중 comic_book 세션이 % 건 있다. 콘텐츠 테이블을 지우면 그 세션이 깨진다.', v_refs;
  END IF;
END $$;

-- 자산이 남아 있으면 테이블만 지웠을 때 고아 파일이 된다. 먼저 확인만 하고 알린다.
DO $$
DECLARE
  v_objects INTEGER;
BEGIN
  SELECT count(*) INTO v_objects FROM storage.objects WHERE bucket_id = 'comic-book-assets';
  IF v_objects > 0 THEN
    RAISE NOTICE 'comic-book-assets 에 객체가 % 건 남아 있다. 버킷은 지우지 않고 유지한다.', v_objects;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_game_comic_books_updated_at ON game_comic_books;
DROP FUNCTION IF EXISTS public.set_game_comic_books_updated_at();

DROP POLICY IF EXISTS "comic_book_assets_service_only" ON storage.objects;

DROP TABLE IF EXISTS game_comic_pages;
DROP TABLE IF EXISTS game_comic_book_versions;
DROP TABLE IF EXISTS game_comic_books;

-- 버킷은 지우지 않는다. 객체가 남아 있으면 삭제가 실패하고,
-- 비어 있더라도 재적용 시 ON CONFLICT DO NOTHING 으로 그대로 재사용된다.
