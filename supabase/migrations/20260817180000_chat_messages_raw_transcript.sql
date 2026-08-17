-- ==============================================================================
-- 097 Phase B — 음성 인식 원문 보존
--
-- 문맥 기반 재해석(097)이 STT 전사를 고쳐 쓰면, 아이가 실제로 뭐라고 말했는지가
-- 사라진다. 재해석이 틀렸을 때 그걸 확인할 방법이 없으면 디버깅도, 품질 측정도
-- 못 한다. 요청서 §3-5 는 원문과 재해석 결과를 구분해 남기라고 요구한다.
--
-- 설계:
--   content        = 화면·판정에 실제로 쓰인 텍스트 (재해석됐으면 재해석본)
--   raw_transcript = 재해석 전 STT 원문. 재해석이 없었으면 NULL
--
-- raw_transcript IS NULL 이면 content 가 곧 원문이다. 매 턴 원문을 중복 저장하지
-- 않으려고 이렇게 둔다 — 재해석은 소수 턴에서만 일어난다.
--
-- 기존 행은 전부 NULL 이 되고, 그건 "재해석 없음"이라는 정확한 의미다.
-- 과거 데이터를 건드리지 않는다 (요청서 §4).
-- ==============================================================================

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS raw_transcript TEXT;

COMMENT ON COLUMN chat_messages.raw_transcript IS
  '097: 문맥 재해석 전 STT 원문. 재해석이 일어난 턴에만 채운다. NULL 이면 content 가 원문이다.';

-- 재해석이 실제로 얼마나 일어나는지, 어떤 방향으로 바뀌는지 조회하기 위한 인덱스.
-- 전체 행의 소수만 NOT NULL 이므로 partial index 로 둔다.
CREATE INDEX IF NOT EXISTS idx_chat_messages_rescored
  ON chat_messages (session_id, created_at)
  WHERE raw_transcript IS NOT NULL;
