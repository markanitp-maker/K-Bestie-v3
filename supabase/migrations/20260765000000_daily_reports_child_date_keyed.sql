-- requests/017-report-check.md — 리포트 생성 책임을 세션 단위에서 "아이+날짜" 단위로 통합.
-- 개발 서버(mkrsaaedxqrcrktapaus) 전용 — Production에는 별도 승인 없이 적용하지 않는다.
--
-- 배경: daily_reports가 지금까지 session_id 1개당 1행으로 설계돼 있어(세션 종료 즉시
-- 생성 경로 app/api/report/generate와, 하루 1회 배치 generateDailyReports가 서로 다른
-- 시점에 각자 session_id 기준으로 행을 만듦), 같은 날 같은 아이가 여러 번 대화하면
-- 리포트가 여러 개로 쪼개지고(§4.2 "child_id+business_date=1개" 위반), 미션 세션은
-- chat_sessions.ended_at을 절대 채우지 않아 배치의 session_id 조회 대상에서
-- 항상 빠졌다. child_id+business_date를 새 식별자로 추가해 "하루 1아이 1리포트"로
-- 통합한다. session_id는 더 이상 유일 식별자가 아니므로(리포트가 여러 세션을 묶으므로)
-- NULL 허용으로 완화한다 — 기존 FK/인덱스는 유지(과거 데이터 호환).

ALTER TABLE public.daily_reports
  ALTER COLUMN session_id DROP NOT NULL;

ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS child_id UUID REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS business_date DATE;

-- 기존 행 백필: session_id → chat_sessions.child_id, business_date는 생성 시각(KST) 기준
-- 근사치(과거 데이터 호환용 - 실제 대화 발생일과 리포트 생성일이 대개 같은 날 새벽이라
-- created_at 기준으로도 충분히 정확하다).
UPDATE public.daily_reports dr
SET
  child_id = cs.child_id,
  business_date = (dr.created_at AT TIME ZONE 'Asia/Seoul')::date
FROM public.chat_sessions cs
WHERE dr.session_id = cs.id
  AND dr.child_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_reports_child_date
  ON public.daily_reports (child_id, business_date);

-- 참고: 하드 UNIQUE(child_id, business_date) 제약은 걸지 않는다 — 기존에 세션당
-- 여러 행이 이미 쌓여 있어(과거 즉시생성 경로) 즉시 위반이 발생한다. 중복 방지는
-- 배치 코드의 upsert 로직(child_id+business_date 조회 후 갱신)으로 처리한다.

GRANT ALL ON public.daily_reports TO anon, authenticated;
