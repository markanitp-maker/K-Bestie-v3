-- codex 리뷰 지적: 같은 날짜의 배치를 재실행(수동 재시도 등)하면 같은 대화를 다시 "새로운
-- 독립 evidence"로 취급해 source_count를 또 올리고, candidate가 실제로는 같은 날짜
-- 재확인일 뿐인데 2건으로 오인되어 active로 승격될 수 있었다(설계 문서 §3-4e "서로 다른
-- 날짜"라는 조건을 코드가 강제하지 않았음). source_date를 evidence에 저장해, 같은
-- fact_id+source_date 조합이 이미 있으면 재확인으로 세지 않도록(코드에서 이 컬럼으로
-- 사전 체크) 강제할 수 있게 한다.
ALTER TABLE memory_evidence ADD COLUMN IF NOT EXISTS source_date DATE;

-- 같은 fact가 같은 날짜에 중복 evidence를 만들지 못하도록 DB 레벨에서도 강제한다
-- (애플리케이션 체크가 실수로 빠져도 안전망이 되도록).
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_evidence_fact_source_date
  ON memory_evidence(memory_fact_id, source_date);
