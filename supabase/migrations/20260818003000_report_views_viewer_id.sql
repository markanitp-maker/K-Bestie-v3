-- 096 §3-11: report_views 에 viewer_id 를 추가한다.
--
-- 지금은 누가 봤는지 기록이 없어(id, report_id, viewed_at 뿐) 한 가족의 열람을
-- 모든 보호자에게 똑같이 복사해 보여주고 있다. 엄마가 본 리포트를 아빠도 본 것처럼
-- 표시된다. 부모별 열람을 실제로 나누려면 보는 사람이 누구인지 남아야 한다.
--
-- NULL 을 허용한다. 기존 기록은 누가 봤는지 알 수 없고, 요청서 §3-14 가
-- **소급 추정 금지**를 명시했다. 과거 행은 가족 단위 집계에만 쓰고 부모별
-- 개인 열람에는 귀속하지 않는다. Backfill 하지 않는다.
--
-- ON DELETE SET NULL: 부모 계정이 지워져도 열람 사실(가족 단위 집계)은 남아야 한다.
-- CASCADE 로 지우면 과거 리포트 열람률이 소급해서 바뀐다.

ALTER TABLE public.report_views
  ADD COLUMN IF NOT EXISTS viewer_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

-- 부모별 열람 집계는 "이 사람이 본 고유 report_id" 를 세는 형태다.
-- viewer_id 가 NULL 인 과거 행은 이 인덱스를 타지 않아도 되므로 부분 인덱스로 둔다.
CREATE INDEX IF NOT EXISTS report_views_viewer_id_report_id_idx
  ON public.report_views (viewer_id, report_id)
  WHERE viewer_id IS NOT NULL;

COMMENT ON COLUMN public.report_views.viewer_id IS
  '리포트를 연 보호자(auth.users.id). 096 계측 시작 전 기록은 NULL 이며 소급 추정하지 않는다.';
