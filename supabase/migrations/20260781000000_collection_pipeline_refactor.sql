-- 1. chat_messages에 collected_at 추가
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;

-- 2. 기존 raw/corrected 테이블 백업 (안전장치)
ALTER TABLE IF EXISTS public.corrected_daily_conversations RENAME TO corrected_daily_conversations_v1;
ALTER TABLE IF EXISTS public.raw_daily_conversations RENAME TO raw_daily_conversations_v1;

-- 3. 새로운 raw_daily_conversations (하루 한 통) 생성
CREATE TABLE public.raw_daily_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL,
  business_date DATE NOT NULL,
  mission_1 JSONB DEFAULT '[]'::jsonb,
  free_chat_1 JSONB DEFAULT '[]'::jsonb,
  mission_2 JSONB DEFAULT '[]'::jsonb,
  free_chat_2 JSONB DEFAULT '[]'::jsonb,
  first_collected_at TIMESTAMPTZ,
  second_collected_at TIMESTAMPTZ,
  collection_status TEXT NOT NULL DEFAULT 'partial' CHECK (collection_status IN ('partial', 'complete', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(child_id, business_date)
);

-- 4. 새로운 corrected_daily_conversations (하루 한 통) 생성
CREATE TABLE public.corrected_daily_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_conversation_id UUID NOT NULL UNIQUE REFERENCES public.raw_daily_conversations(id) ON DELETE CASCADE,
  child_id UUID NOT NULL,
  business_date DATE NOT NULL,
  corrected_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending', 'corrected', 'uncertain', 'failed')),
  correction_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_generated_at TIMESTAMPTZ
);
