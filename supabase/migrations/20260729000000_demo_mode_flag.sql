-- 오늘 밤 영상 촬영용 MISSION_FIXED_DEMO_MODE 세션을 정식 리포트 집계에서 제외하기 위한 플래그.
-- 기존 데이터는 전부 false로 유지(멱등, 기존 행 영향 없음).
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS demo_mode BOOLEAN NOT NULL DEFAULT false;
