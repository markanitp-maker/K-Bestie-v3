-- 요청서 020 §3-9 — 심야 Batch LLM 트래픽 평탄화.
--
-- [요청서의 전제와 실제가 다르다 — 실측 결과]
-- 요청서는 Context Correction 00:10 / Memory 00:20 / Daily Report 00:30 처럼 고정 시각에
-- 도는 것으로 보고 "01:00 / 02:00 / 03:00 으로 분리" 를 제안했다. 실제 Production
-- pg_cron 을 조회해 보면 그 세 워커는 고정 시각이 아니라 **전부 `*/10 * * * *`**,
-- 즉 매 10분마다 **같은 분에 동시에** 큐를 폴링한다(2026-08-19 실측).
--   */10 * * * *  v3-context-correction-worker
--   */10 * * * *  v3-daily-report-worker
--   */10 * * * *  v3-memory-worker
--   */10 * * * *  kbestie-prod-reconcile-10min
--
-- 그래서 진짜 버스트 원인은 "심야에 몰린 고정 시각" 이 아니라 **세 LLM 워커가 하루 종일
-- 매 10분 같은 순간에 동시에 시작하는 것** 이다. 고정 시각으로 옮기는 것은 이 구조에
-- 맞지 않는다(폴링 워커는 큐에 일이 있을 때만 일한다).
--
-- 요청서의 의도(동시 시작을 피해 Vertex 요청을 시간축으로 흩는다)를 실제 구조에 맞게
-- 적용한다 — 세 워커의 시작 분을 3분씩 어긋나게 둔다.
--   context-correction : 0, 10, 20, 30, 40, 50
--   memory             : 3, 13, 23, 33, 43, 53
--   daily-report       : 6, 16, 26, 36, 46, 56
--
-- [처리 순서 의존성 (§3-13)]
-- 폴링 워커는 상류가 큐에 넣은 뒤에만 일감이 생긴다. 3분 간격은 순서를 깨뜨리지 않고
-- 오히려 같은 사이클 안에서 correction -> memory -> report 순서를 자연스럽게 만든다.
--
-- [reconcile 은 건드리지 않는다]
-- 요청서 §3-9 도 "Reconcile 이 특정 Batch 실패 복구를 더 일찍 수행해야 하는 현재 정책이
-- 있다면 임의 변경하지 않는다" 고 못 박았다. reconcile 은 LLM 을 부르지 않는 정리 작업이라
-- 버스트에 기여하지 않는다. 실패 복구 지연을 만들 이유가 없어 그대로 둔다.
--
-- cron.alter_job 은 스케줄만 바꾼다 — command·활성 여부는 건드리지 않는다.

SELECT cron.alter_job(jobid, schedule => '3-59/10 * * * *')
FROM cron.job WHERE jobname = 'v3-memory-worker';

SELECT cron.alter_job(jobid, schedule => '6-59/10 * * * *')
FROM cron.job WHERE jobname = 'v3-daily-report-worker';
