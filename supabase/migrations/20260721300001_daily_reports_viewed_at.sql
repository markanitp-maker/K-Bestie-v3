-- app/api/parent/reports/route.ts가 daily_reports.viewed_at 컬럼을 직접 SELECT하는데
-- 원래 스키마 설계(phase1_schema.sql)는 열람 여부를 report_views 조인 테이블로만 추적하도록
-- 되어 있어 해당 컬럼이 존재한 적이 없다 — 이 때문에 부모 리포트 목록 조회 API가 500을 반환한다.
-- 최소 침습적 수정: nullable timestamptz 컬럼만 추가한다(기존 컬럼 변경/데이터 삭제 없음).
-- 주의: 이 마이그레이션은 API 500을 해소할 뿐, "열람 표시"(app/api/parent/reports/[id]/viewed/route.ts)는
-- 여전히 report_views에만 INSERT하므로 이 컬럼은 항상 NULL로 남는다 — 별도 후속 작업 필요(오늘 범위 아님).
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ NULL;
