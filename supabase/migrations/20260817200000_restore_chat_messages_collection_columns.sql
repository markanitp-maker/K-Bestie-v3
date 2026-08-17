-- ==============================================================================
-- 075 — Dev 의 chat_messages 수집 컬럼 복구
--
-- 증상: Dev 에서 아이 대화가 141건 쌓였는데 child_memory 는 0건이었다.
--       케이가 "기억 안 나는 걸 어떡해"라고 답했고 아이가 직접 지적했다.
--       074 관계 엔진은 정상 동작했으나(W1 / G3_MEET / frozen_at 기록됨)
--       memory_refs 가 빈 배열이었다 — 먹일 기억이 없었다.
--
-- 원인: 20260801110000_revert_20260781.sql 이 collected_at 을 DROP 하면서
--       "phase 1 마이그레이션이 깨끗하게 다시 추가할 수 있도록"이라고 남겼는데,
--       그 재추가가 Dev 에 적용되지 않았다. 수집이 어디까지 됐는지 표시할 자리가
--       없으니 수집 → 정정 → 메모리 파이프라인이 진행되지 못했다.
--       Production 에는 두 컬럼이 정상적으로 있다.
--
-- 이 파일은 Dev 를 Production 스키마에 맞추는 것이 전부다.
-- 컬럼 정의·인덱스 모두 Production 실측값을 그대로 옮겼다.
--
-- 기존 행은 collected_at 이 NULL 이 되고, 그건 "아직 수집 안 됨"이라는 정확한
-- 의미다. 밀린 대화가 다음 배치에서 정상적으로 수집 대상이 된다.
-- ==============================================================================

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS collection_batch_id UUID;

COMMENT ON COLUMN public.chat_messages.collected_at IS
  '수집 배치가 이 메시지를 가져간 시각. NULL 이면 아직 수집되지 않았다.';
COMMENT ON COLUMN public.chat_messages.collection_batch_id IS
  '이 메시지를 가져간 수집 배치 id.';

-- 미수집 메시지를 찾는 조회용. 대다수 행이 수집 완료 상태가 되므로 partial 로 둔다.
CREATE INDEX IF NOT EXISTS idx_chat_messages_uncollected
  ON public.chat_messages USING btree (created_at)
  WHERE collected_at IS NULL;

-- 정리(cleanup) 배치가 오래된 수집분을 오래된 순서로 지울 때 쓴다.
CREATE INDEX IF NOT EXISTS idx_chat_messages_collected_at
  ON public.chat_messages USING btree (collected_at, id)
  WHERE collected_at IS NOT NULL;
