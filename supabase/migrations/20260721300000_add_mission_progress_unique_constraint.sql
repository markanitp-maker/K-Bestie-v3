ALTER TABLE mission_progress
ADD COLUMN child_id UUID REFERENCES child_profiles(id) ON DELETE CASCADE,
ADD COLUMN business_date TEXT;

-- 기존 데이터에 대한 안전한 마이그레이션 (세션 테이블 조인)
UPDATE mission_progress mp
SET 
  child_id = cs.child_id,
  business_date = to_char((cs.started_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD')
FROM chat_sessions cs
WHERE mp.session_id = cs.id;

-- Not Null 제약조건 (기존 데이터 완벽 정리 가정 시)
ALTER TABLE mission_progress
ALTER COLUMN child_id SET NOT NULL,
ALTER COLUMN business_date SET NOT NULL;

-- 과거 중복 데이터 44건 존재로 하드 유니크 인덱스 미적용 — 애플리케이션 레벨 멱등 조회(app/api/mission/start/route.ts의 기존 세션 조회 로직)가 유일한 방어선
