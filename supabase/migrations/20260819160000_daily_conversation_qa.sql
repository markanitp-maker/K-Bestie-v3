-- 요청서 019 — 일일 24시간 대화 자동 QA 결과 저장소.
--
-- 목적: 매일 02:00 KST 에 지난 24시간 실제 아이 대화를 전수 스캔해서 발견한 이슈를
-- 관리자 `운영 도구 > 이슈 사항` 탭에 누적 표시한다. 단순 로그 화면이 아니라
-- "패치 이후 실제 운영 대화에서 문제가 줄었는지 / 재발했는지" 를 매일 판정하는 것이 목적이다.
--
-- [원문을 복제하지 않는다 (§3-13)]
-- 대화 원문은 chat_messages 에만 둔다. 여기에는 session_id / message_id 와
-- 익명화된 최소 excerpt(대표 사례 1~3개, 200자 이내)만 남긴다. 원문 7일 보존 정책과
-- 이 테이블의 보존 정책이 어긋나지 않게 하려면 원문을 여기 복제하지 않는 것이 유일한 방법이다.
--
-- [권한 (§3-16)]
-- 배치(service_role)가 쓰고, 관리자 API 가 서버에서 읽는다. 둘 다 service_role 로 돈다.
-- 부모·아이·anon 은 접근할 이유가 없다 — RLS on, policy 없음, 권한 회수.

CREATE TABLE IF NOT EXISTS public.daily_conversation_qa_runs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 분석 대상 24시간 구간. business_date 는 KST 기준 날짜다(§3-18).
  window_start            timestamptz NOT NULL,
  window_end              timestamptz NOT NULL,
  business_date           date NOT NULL,
  status                  text NOT NULL DEFAULT 'RUNNING'
                            CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED')),
  -- 트리거 주체. 수동 재점검(§3-20)과 크론을 구분해야 실패 원인을 되짚을 수 있다.
  trigger_source          text NOT NULL DEFAULT 'cron'
                            CHECK (trigger_source IN ('cron', 'manual')),
  -- 중복 Run 방지 키(§3-21). 크론과 수동 실행이 겹쳐도 같은 window 를 두 번 저장하지 않는다.
  execution_key           text NOT NULL UNIQUE,
  total_children          integer NOT NULL DEFAULT 0,
  total_sessions          integer NOT NULL DEFAULT 0,
  mission_sessions        integer NOT NULL DEFAULT 0,
  free_chat_sessions      integer NOT NULL DEFAULT 0,
  analyzed_sessions       integer NOT NULL DEFAULT 0,
  -- 테스트/QA 계정은 분석 대상에서 뺀다(§3-26). 뺀 개수를 남겨 두면
  -- "0건" 이 정상인지 필터가 과했는지 구분할 수 있다.
  skipped_test_sessions   integer NOT NULL DEFAULT 0,
  total_messages          integer NOT NULL DEFAULT 0,
  analyzed_messages       integer NOT NULL DEFAULT 0,
  issue_count             integer NOT NULL DEFAULT 0,
  blocker_count           integer NOT NULL DEFAULT 0,
  high_count              integer NOT NULL DEFAULT 0,
  medium_count            integer NOT NULL DEFAULT 0,
  low_count               integer NOT NULL DEFAULT 0,
  failed_session_count    integer NOT NULL DEFAULT 0,
  error_summary           text,
  started_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_conversation_qa_runs_window_chk CHECK (window_end > window_start)
);

CREATE INDEX IF NOT EXISTS daily_conversation_qa_runs_business_date_idx
  ON public.daily_conversation_qa_runs(business_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.daily_conversation_qa_issues (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                    uuid NOT NULL REFERENCES public.daily_conversation_qa_runs(id) ON DELETE CASCADE,
  business_date             date NOT NULL,
  taxonomy_code             text NOT NULL,
  severity                  text NOT NULL CHECK (severity IN ('BLOCKER', 'HIGH', 'MEDIUM', 'LOW')),
  -- 전일 대비 상태(§3-11). RESOLVED_CANDIDATE 는 "해결됨" 이 아니다 —
  -- 하루 0건으로 해결을 확정하지 않는다.
  trend_status              text NOT NULL
                              CHECK (trend_status IN ('NEW', 'RECURRED', 'ONGOING', 'IMPROVED', 'RESOLVED_CANDIDATE')),
  title                     text NOT NULL,
  summary                   text,
  event_count               integer NOT NULL DEFAULT 0,
  affected_children_count   integer NOT NULL DEFAULT 0,
  affected_sessions_count   integer NOT NULL DEFAULT 0,
  -- 절대 건수만으로 악화/개선을 단정하지 않기 위한 분모(§3-12).
  analyzed_sessions         integer NOT NULL DEFAULT 0,
  prev_event_count          integer,
  prev_affected_sessions    integer,
  first_detected_at         timestamptz,
  last_detected_at          timestamptz,
  -- 대표 사례 1~3개. { sessionId, messageId, excerpt } 형태. excerpt 는 200자 이내(§3-13).
  representative_examples   jsonb NOT NULL DEFAULT '[]'::jsonb,
  session_ids               uuid[] NOT NULL DEFAULT '{}',
  message_ids               uuid[] NOT NULL DEFAULT '{}',
  root_cause_hint           text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  -- 같은 Run 안에서 같은 taxonomy 가 두 줄로 갈라지면 KPI 합계가 어긋난다.
  CONSTRAINT daily_conversation_qa_issues_run_taxonomy_uniq UNIQUE (run_id, taxonomy_code)
);

CREATE INDEX IF NOT EXISTS daily_conversation_qa_issues_date_idx
  ON public.daily_conversation_qa_issues(business_date DESC, severity);

CREATE INDEX IF NOT EXISTS daily_conversation_qa_issues_taxonomy_idx
  ON public.daily_conversation_qa_issues(taxonomy_code, business_date DESC);

ALTER TABLE public.daily_conversation_qa_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_conversation_qa_issues ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.daily_conversation_qa_runs FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.daily_conversation_qa_issues FROM anon, authenticated;

COMMENT ON TABLE public.daily_conversation_qa_runs IS
  '019 일일 대화 자동 QA 실행 기록. 서버 service_role 전용 — RLS on, policy 없음. execution_key UNIQUE 로 중복 Run 방지.';
COMMENT ON TABLE public.daily_conversation_qa_issues IS
  '019 일일 대화 자동 QA 이슈. 대화 원문을 복제하지 않고 session/message id 와 200자 이내 excerpt 만 남긴다.';
