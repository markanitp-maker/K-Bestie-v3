-- requests/018 §3 — 수집 배치(18:00/23:59:59 KST)와 리포트 배치(03:00 KST) 스케줄 등록.
-- 기존 kbestie-dev-memory-batch-1/2 잡이 이미 같은 시각(09:00/14:59 UTC = 18:00/23:59 KST)에
-- 등록돼 있어 그 cadence를 그대로 따르되, 별도 목적(memory-batch)의 잡을 건드리지 않고
-- 새 잡을 추가한다. daily-batch(리포트 생성)는 기존 04:00 KST(19:00 UTC)에서 018이 요구하는
-- 03:00 KST(18:00 UTC)로 조정한다. Dev 프로젝트(mkrsaaedxqrcrktapaus)에만 적용.

SELECT cron.schedule(
  'kbestie-dev-collection-batch-1',
  '0 9 * * *', -- 18:00 KST
  $$
  select net.http_post(
    url     := 'https://k-bestie-v3-dev.vercel.app/api/batch/collection',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer 29b2722d6b3c793414c248f1db75b5266273422fec5db1700d66a773c9b06583'),
    body    := jsonb_build_object()
  );
  $$
);

SELECT cron.schedule(
  'kbestie-dev-collection-batch-2',
  '59 14 * * *', -- 23:59 KST
  $$
  select net.http_post(
    url     := 'https://k-bestie-v3-dev.vercel.app/api/batch/collection',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer 29b2722d6b3c793414c248f1db75b5266273422fec5db1700d66a773c9b06583'),
    body    := jsonb_build_object()
  );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'kbestie-dev-daily-batch'),
  schedule := '0 18 * * *' -- 03:00 KST (기존 04:00 KST에서 조정)
);

-- 진단용 임시 함수 제거(20260746000000에서 조회 목적으로만 생성했음).
DROP FUNCTION IF EXISTS public.debug_list_cron_jobs();
