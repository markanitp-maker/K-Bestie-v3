-- 실행 금지 — 검토 및 승인 후 대표가 직접 실행
-- kbestie-daily-batch 등 스케줄을 03:00 KST 리포트생성 + 18:00/01:00 KST 수집배치로 재조정

-- 1. 리포트 생성 배치 (kbestie-daily-batch): 매일 03:00 KST (전날 18:00 UTC)
-- 기존 04:00 KST 에서 03:00 KST 로 앞당김.
SELECT cron.alter_job('kbestie-daily-batch', '0 18 * * *');

-- 2. 수집 배치 (kbestie-collection-batch): 매일 18:00 KST (09:00 UTC) 및 01:00 KST (전날 16:00 UTC)
-- 만약 해당 job이 등록되어 있다면 아래의 alter_job으로 스케줄 조정
SELECT cron.alter_job('kbestie-collection-batch', '0 9,16 * * *');

-- (참고용) 만약 collection batch 가 아직 job으로 등록되지 않았다면, 아래의 형태로 schedule 등록 필요:
/*
SELECT cron.schedule(
  'kbestie-collection-batch',
  '0 9,16 * * *',
  $$
  select net.http_post(
    url     := 'https://fetvnhhjicndmxvhrffk.supabase.co/functions/v1/collection-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <BATCH_SECRET>'
    ),
    body    := jsonb_build_object()
  );
  $$
);
*/
