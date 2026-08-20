-- K-Toon 콘텐츠 데이터 모델 + 전용 Storage 버킷
--
-- 정본 계약: docs/ops/integration-contract.md §9
-- 제품 규칙: K-Toon/.omc/plans/prd-k-toon.md §5, §7
--
-- 설계 요지 — **버전 단위는 책 전체다.**
--   관리자 편집은 이미지 "전체 세트 재업로드"만 허용한다(SPEC §37 확정).
--   페이지 일부 교체·삽입·삭제를 지원하지 않으므로 페이지 단위 asset 재사용이나
--   ref-counting 이 필요 없다. 그래서 version 행이 페이지 묶음 하나를 통째로 가리킨다.
--   이 단순함이 GC 와 세션 고정을 동시에 쉽게 만든다.
--
--   메타(제목·줄거리·공개여부) 수정은 version 을 올리지 않는다. 이미지 세트를
--   다시 올릴 때만 +1 한다. 진행 중 세션은 시작 당시 version 을 끝까지 본다.

-- ================================================================
-- 1. game_comic_books — 책 메타
-- ================================================================
CREATE TABLE IF NOT EXISTS game_comic_books (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  synopsis        TEXT NOT NULL DEFAULT '',
  -- 현재 공개 중인 버전. NULL 이면 아직 Publish 된 적이 없다.
  published_version INTEGER,
  is_published    BOOLEAN NOT NULL DEFAULT false,
  -- soft delete. 30일 휴지통(SPEC P1-5). 물리 삭제는 GC 잡이 참조 안전성 확인 후 한다.
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE game_comic_books IS
  'K-Toon(만화책 읽기) 책 메타. 이미지 자산은 comic-book-assets 버킷에 있고
   버전 단위는 책 전체다(페이지 단위 편집 미지원). Ownership 은 K-Bestie 이며
   K-Toon 은 Internal Content API 로만 읽는다(통합 계약 §8, §9).';

COMMENT ON COLUMN game_comic_books.published_version IS
  '현재 공개 버전. 신규 세션은 이 버전을 받는다. 진행 중 세션은 자기 selectedBookVersion 을 계속 본다.';

CREATE INDEX IF NOT EXISTS idx_game_comic_books_catalog
  ON game_comic_books (is_published, created_at DESC)
  WHERE deleted_at IS NULL;

-- ================================================================
-- 2. game_comic_book_versions — immutable 버전
-- ================================================================
CREATE TABLE IF NOT EXISTS game_comic_book_versions (
  book_id       UUID NOT NULL REFERENCES game_comic_books(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL CHECK (version >= 1),
  -- 본문 페이지 수(표지 제외). 업로드 Validation 상한과 같다(PRD §5).
  page_count    INTEGER NOT NULL CHECK (page_count BETWEEN 1 AND 60),
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, version)
);

COMMENT ON TABLE game_comic_book_versions IS
  '한 번 만들어지면 바뀌지 않는다. 이미지 세트를 다시 올리면 새 version 행이 생기고
   기존 행과 그 자산은 그대로 남는다 — 읽던 아이의 그림이 중간에 바뀌면 안 되기 때문이다.';

-- ================================================================
-- 3. game_comic_pages — 페이지 자산 참조
-- ================================================================
CREATE TABLE IF NOT EXISTS game_comic_pages (
  book_id       UUID NOT NULL,
  version       INTEGER NOT NULL,
  -- 0 = 표지(00.jpg), 1부터 본문. 파일명이 Source of Truth 다(SPEC §12).
  page_number   INTEGER NOT NULL CHECK (page_number >= 0),
  -- signed URL 이 아니라 **경로**를 저장한다. URL 은 조회 시점에 서버가 발급한다(계약 §9).
  storage_path  TEXT NOT NULL,
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/webp')),
  byte_size     BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 5 * 1024 * 1024),
  width         INTEGER NOT NULL CHECK (width >= 1080),
  height        INTEGER NOT NULL CHECK (height > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, version, page_number),
  FOREIGN KEY (book_id, version)
    REFERENCES game_comic_book_versions(book_id, version) ON DELETE CASCADE
);

COMMENT ON COLUMN game_comic_pages.storage_path IS
  '버킷 내 경로. comic/{bookId}/{version}/{NN}.{ext} 형식이며 같은 경로를 덮어쓰지 않는다.
   signed URL 을 저장하지 않는 이유는 URL 이 만료되기 때문이다(계약 §9).';

-- 같은 자산 경로가 두 곳에서 쓰이면 GC 가 살아있는 참조를 지울 수 있다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_comic_pages_storage_path
  ON game_comic_pages (storage_path);

-- ================================================================
-- 4. RLS — 쓰기는 service_role 전용
-- ================================================================
-- 관리자 쓰기는 K-Bestie server-side Admin API 만 수행한다(계약 §8).
-- 브라우저에서 직접 쓰는 경로를 두지 않는다.
ALTER TABLE game_comic_books         ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_comic_book_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_comic_pages         ENABLE ROW LEVEL SECURITY;

-- 정책을 동적 SQL 로 만들지 않는다. 마이그레이션 안전 검사기가 EXECUTE 를
-- 정적으로 검증하지 못해 destructive 로 잡고, 무엇보다 읽는 사람이 실제로
-- 어떤 정책이 생기는지 파일만 보고 알 수 없다.
DROP POLICY IF EXISTS game_comic_books_service_only ON game_comic_books;
CREATE POLICY game_comic_books_service_only ON game_comic_books
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS game_comic_book_versions_service_only ON game_comic_book_versions;
CREATE POLICY game_comic_book_versions_service_only ON game_comic_book_versions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS game_comic_pages_service_only ON game_comic_pages;
CREATE POLICY game_comic_pages_service_only ON game_comic_pages
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ================================================================
-- 5. K-Toon 전용 Storage 버킷
-- ================================================================
-- private 이다. 아이용 이미지는 Internal Content API 가 signed URL 을 발급해 전달한다.
-- 기존 feedback-attachments 버킷을 재사용하지 않는다 — 수명·접근 주체·정리 정책이 다르다.
INSERT INTO storage.buckets (id, name, public)
VALUES ('comic-book-assets', 'comic-book-assets', false)
ON CONFLICT (id) DO NOTHING;

-- 버킷 접근도 service_role 전용이다. 브라우저는 signed URL 로만 이미지를 받는다.
DROP POLICY IF EXISTS "comic_book_assets_service_only" ON storage.objects;
CREATE POLICY "comic_book_assets_service_only"
  ON storage.objects FOR ALL
  USING (bucket_id = 'comic-book-assets' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'comic-book-assets' AND auth.role() = 'service_role');

-- ================================================================
-- 6. updated_at 트리거
-- ================================================================
CREATE OR REPLACE FUNCTION public.set_game_comic_books_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_game_comic_books_updated_at ON game_comic_books;
CREATE TRIGGER trg_game_comic_books_updated_at
  BEFORE UPDATE ON game_comic_books
  FOR EACH ROW EXECUTE FUNCTION public.set_game_comic_books_updated_at();

-- ================================================================
-- 7. 검증
-- ================================================================
DO $$
DECLARE
  v_missing TEXT;
  v_bucket_public BOOLEAN;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY['game_comic_books', 'game_comic_book_versions', 'game_comic_pages']) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '테이블 누락: %', v_missing;
  END IF;

  SELECT string_agg(c.relname::text, ', ') INTO v_missing
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('game_comic_books', 'game_comic_book_versions', 'game_comic_pages')
    AND c.relrowsecurity = false;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS 미활성 테이블: %', v_missing;
  END IF;

  SELECT public INTO v_bucket_public FROM storage.buckets WHERE id = 'comic-book-assets';
  IF v_bucket_public IS NULL THEN
    RAISE EXCEPTION 'comic-book-assets 버킷이 없다';
  END IF;
  IF v_bucket_public THEN
    RAISE EXCEPTION 'comic-book-assets 버킷이 public 이다. private 이어야 한다';
  END IF;
END $$;
