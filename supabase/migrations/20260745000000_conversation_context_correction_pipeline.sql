-- requests/018-conversation-context-correction-pipeline.md
-- Raw 대화 수집 → Gemini 맥락 보정 → corrected 데이터 저장 → 리포트 생성 파이프라인용 신규 테이블.
-- 개발 서버(mkrsaaedxqrcrktapaus) 전용 마이그레이션 — Production에는 별도 승인 없이 적용하지 않는다.

CREATE TABLE public.raw_daily_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id         UUID NOT NULL,
  session_id       UUID NOT NULL REFERENCES public.chat_sessions(id),
  chat_message_id  UUID NOT NULL REFERENCES public.chat_messages(id),
  speaker          TEXT NOT NULL CHECK (speaker IN ('child', 'k')),
  raw_text         TEXT NOT NULL,
  session_type     TEXT NOT NULL CHECK (session_type IN ('mission', 'free_chat')),
  business_date    DATE NOT NULL,
  turn_order       INTEGER,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 리포트 배치가 이 business_date+child_id 데이터를 실제로 소비/확정한 시각.
  -- NULL이면 아직 리포트에 반영 전 — 7일 자동삭제 대상에서 제외된다.
  report_generated_at TIMESTAMPTZ,
  -- 같은 메시지가 18:00/23:59:59 두 번의 수집 배치에서 중복 수집되지 않도록 원본 메시지 단위로 유일성 보장.
  UNIQUE (chat_message_id)
);

CREATE INDEX idx_raw_daily_conversations_child_date ON public.raw_daily_conversations (child_id, business_date);
CREATE INDEX idx_raw_daily_conversations_retention ON public.raw_daily_conversations (report_generated_at) WHERE report_generated_at IS NOT NULL;

CREATE TABLE public.corrected_daily_conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- child 발화만 보정 대상(k 발화는 raw만 보관하고 corrected 행을 만들지 않는다).
  raw_conversation_id UUID NOT NULL UNIQUE REFERENCES public.raw_daily_conversations(id),
  child_id            UUID NOT NULL,
  session_id          UUID NOT NULL,
  business_date       DATE NOT NULL,
  corrected_text      TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('unchanged', 'corrected', 'uncertain', 'rejected')),
  confidence          NUMERIC(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  report_eligible     BOOLEAN NOT NULL DEFAULT false,
  correction_reason   TEXT,
  uncertain_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_generated_at TIMESTAMPTZ
);

CREATE INDEX idx_corrected_daily_conversations_child_date ON public.corrected_daily_conversations (child_id, business_date);
CREATE INDEX idx_corrected_daily_conversations_eligible ON public.corrected_daily_conversations (business_date) WHERE report_eligible = true;
CREATE INDEX idx_corrected_daily_conversations_retention ON public.corrected_daily_conversations (report_generated_at) WHERE report_generated_at IS NOT NULL;

ALTER TABLE public.raw_daily_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_only_raw_daily_conversations"
  ON public.raw_daily_conversations FOR ALL
  USING (auth.role() = 'service_role');

ALTER TABLE public.corrected_daily_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_only_corrected_daily_conversations"
  ON public.corrected_daily_conversations FOR ALL
  USING (auth.role() = 'service_role');

-- 프로젝트 컨벤션(docs/conventions.md) — Supabase 테이블은 anon/authenticated에 GRANT ALL,
-- 실제 접근 통제는 RLS(위 service_role 전용 정책)로 한다.
GRANT ALL ON public.raw_daily_conversations TO anon, authenticated;
GRANT ALL ON public.corrected_daily_conversations TO anon, authenticated;
