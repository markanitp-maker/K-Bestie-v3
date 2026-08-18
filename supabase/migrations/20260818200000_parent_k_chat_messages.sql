-- 2026-08-18 대표님 결정: 부모–케이 대화 원문 저장 테이블 (parent_k_chat_messages)
--
-- 기존에는 §13(개인정보 로깅 제한) 내부 개발 규칙에 따라 부모 질문 및 케이 응답 원문을
-- 어디에도 저장하지 않고 브라우저 상태로만 유지하였으나,
-- 2026-08-18 대표님 결정으로 부모가 /parent/guide 에서 케이와 나눈 대화 원문을 DB에
-- 영구 보존하도록 방침이 전면 개정되었다.
--
-- 대외 개인정보처리방침 제1조에 이미 "서비스 이용 과정: 대화 텍스트 … 처리"가
-- 고지되어 있으므로 별도의 대외 방침 개정 없이 진행 가능하다.
--
-- [운영 및 보안 규칙]
-- 1. 운영 조사 보존을 위해 parent_id 에 auth.users 외래키(FK)를 걸지 않는다(behavior_events 관례).
--    계정 탈퇴/삭제 시에도 대화 기록이 연쇄 삭제(CASCADE)되어 조사가 불가능해지는 사태를 방지한다.
-- 2. 자녀(child_id)는 대화 도중 바뀔 수 있으므로 턴마다 기록하며, 자녀 미선택 대화일 경우 NULL을 허용한다.
-- 3. RLS(Row Level Security)를 활성화하여 부모는 본인의 대화만 조회할 수 있게 격리한다(사고 방지).

CREATE TABLE IF NOT EXISTS public.parent_k_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL,
  child_id UUID NULL,
  role TEXT NOT NULL CHECK (role IN ('parent', 'k')),
  content TEXT NOT NULL,
  route TEXT NULL,
  answerable BOOLEAN NULL,
  environment TEXT NOT NULL CHECK (environment IN ('dev', 'prod')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

-- 인덱스: 부모별 대화 이력 조회 (최신순)
CREATE INDEX IF NOT EXISTS parent_k_chat_messages_parent_id_created_at_idx
  ON public.parent_k_chat_messages (parent_id, created_at DESC);

-- 인덱스: 자녀별 대화 이력 조회 (최신순, 부분 인덱스)
CREATE INDEX IF NOT EXISTS parent_k_chat_messages_child_id_created_at_idx
  ON public.parent_k_chat_messages (child_id, created_at DESC)
  WHERE child_id IS NOT NULL;

-- RLS 활성화 및 접근 제어 정책
ALTER TABLE public.parent_k_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parent_k_chat_messages_access ON public.parent_k_chat_messages;
CREATE POLICY parent_k_chat_messages_access ON public.parent_k_chat_messages
  FOR ALL USING (
    auth.role() = 'service_role'
    OR parent_id = auth.uid()
  );

GRANT ALL ON public.parent_k_chat_messages TO anon, authenticated;

COMMENT ON TABLE public.parent_k_chat_messages IS
  '부모-케이 대화 원문 및 라우팅 결과 저장 테이블 (2026-08-18 대표님 결정으로 §13 개정)';
