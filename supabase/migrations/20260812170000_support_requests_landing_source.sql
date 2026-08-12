-- 랜딩 비로그인 문의도 기존 support_requests에서 함께 관리한다.
ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

CREATE INDEX IF NOT EXISTS idx_support_requests_source_created_at
  ON public.support_requests (source, created_at DESC)
  WHERE deleted_at IS NULL;
