-- 잔여 레거시 chat_sessions.business_date NULL 25건 백필 (2026-07-29~08-02 생성분).
-- 20260804070000 마이그레이션은 "2026-08-03 생성분만" 백필하도록 명시적으로 범위를
-- 제한했었다(그 요청서 범위 밖이라는 이유). 이번 요청(2026-08-05)은 "모든 신규
-- 미션·자유대화... 기존 수정도 실제 Production 배포 코드와 DB에서 재검증"을 명시
-- 요구하므로, 남은 25건도 동일한 안전한 방식(NULL인 값만 채움, 기존 값 절대 덮어쓰지
-- 않음)으로 백필한다. V3 파이프라인 자체는 chat_sessions.business_date를 참조하지
-- 않으므로(raw_daily_conversations_v3 키는 pipeline_jobs.business_date, 이는 chat_messages
-- 원본 시각 기반) 이 백필은 Collection에 영향 없음 — 부모 화면 등 business_date를
-- 직접 참조하는 다른 기능의 정합성을 위한 정리.
UPDATE chat_sessions
SET business_date = (started_at AT TIME ZONE 'Asia/Seoul')::date
WHERE business_date IS NULL;

-- 검증: 남은 NULL 건수(0이어야 함)
SELECT count(*) as remaining_null FROM chat_sessions WHERE business_date IS NULL;
