-- 초안 (DDL/크론 등록 DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 직접 실행할 것
-- 목적: Supabase pg_cron 이 memory-batch Edge Function 을 호출하도록 등록
--   memory-batch: 매일 18:00 KST, 23:59:59 KST(가장 가까운 59 14 * * *)에 실행
--
-- 아키텍처: 배치 로직은 Supabase Edge Function 이 소스오브트루스.
--
-- 사전 준비 (완료 상태):
--   1. Edge Function 배포: memory-batch
--   2. 시크릿 설정: BATCH_SECRET, GEMMA_API_KEY
--   3. 확장 활성화: pg_cron, pg_net
--   4. <PROJECT_REF>는 fetvnhhjicndmxvhrffk로 치환 완료.
--      <BATCH_SECRET>은 의도적으로 플레이스홀더 그대로 둠.
--   5. 크론 시각은 UTC 기준. KST = UTC+9.
--        18:00 KST = 09:00 UTC
--        23:59 KST = 14:59 UTC

-- ── (1) 메모리 요약 배치 1회차: 매일 18:00 KST = 09:00 UTC ──────────────────────
select cron.schedule(
  'kbestie-memory-batch-1',
  '0 9 * * *',
  $$
  select net.http_post(
    url     := 'https://fetvnhhjicndmxvhrffk.supabase.co/functions/v1/memory-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <BATCH_SECRET>'
    ),
    body    := jsonb_build_object()
  );
  $$
);

-- ── (2) 메모리 요약 배치 2회차: 매일 23:59 KST = 14:59 UTC ──────────────────────
select cron.schedule(
  'kbestie-memory-batch-2',
  '59 14 * * *',
  $$
  select net.http_post(
    url     := 'https://fetvnhhjicndmxvhrffk.supabase.co/functions/v1/memory-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <BATCH_SECRET>'
    ),
    body    := jsonb_build_object()
  );
  $$
);

-- 등록 해제:
--   select cron.unschedule('kbestie-memory-batch-1');
--   select cron.unschedule('kbestie-memory-batch-2');
