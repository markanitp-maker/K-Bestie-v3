-- 대표님 미승인으로 즉시 원상복구 (2026-08-05). 10분 주기 변경을 되돌리고
-- 원래의 하루 1회 스케줄로 복원한다. 근거·증명 완료 후에만 재적용한다.
SELECT cron.alter_job(job_id := 25, schedule := '5 15 * * *');
SELECT cron.alter_job(job_id := 26, schedule := '20 15 * * *');
SELECT cron.alter_job(job_id := 27, schedule := '35 15 * * *');

SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobid IN (25, 26, 27) ORDER BY jobid;
