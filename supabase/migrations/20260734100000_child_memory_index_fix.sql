-- 20260734000000_child_memory.sql의 UNIQUE INDEX 설계 수정.
-- 문제: (child_id, memory_type, business_date, category) 유니크 제약은 같은 날 같은 카테고리로
-- 서로 다른 장기기억(long_term) 사실이 여러 개 감지될 때 upsert가 이전 것을 덮어써 정보가
-- 유실된다(예: 같은 날 "축구를 좋아함"과 "야구도 좋아함"이 둘 다 category='interest'로 감지되면
-- 하나만 남음). short_term은 하루 1건만 있으면 되므로(category가 항상 NULL) 그 경우에만
-- 유니크 제약을 걸고, long_term은 자유롭게 누적되도록 제약을 없앤다.

DROP INDEX IF EXISTS uq_child_memory_batch_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS uq_child_memory_short_term_dedup
  ON child_memory(child_id, business_date)
  WHERE memory_type = 'short_term';
