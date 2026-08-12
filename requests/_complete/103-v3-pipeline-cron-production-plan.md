# V3 Pipeline Cron Schedule Production Deployment Plan

> **STATUS**: PROPOSAL / PENDING REPRESENTATIVE APPROVAL  
> **CLASSIFICATION**: NON-EXECUTABLE ARCHITECTURAL & DEPLOYMENT SPECIFICATION  
> **GOVERNANCE REQUIREMENT**: Representative approval is strictly required before applying this plan to Production. Existing registered jobs must not be altered automatically.

---

## 1. Overview & Architectural Design

This plan specifies the production pg_cron schedule for the V3 Batch Pipeline. The pipeline decouples job enqueueing from job execution, enforcing safe boundary checks, state machine transitions, and concurrency locks via SECURITY DEFINER PostgreSQL RPCs.

### Rationale: 23:55 Enqueue vs 00:00 Finalize Split for Phase 2
- **Phase 2 Enqueue (14:55 UTC / 23:55 KST)**: The enqueue RPC (`enqueue_collection_jobs_v3`) is triggered at 23:55 KST. It generates `pipeline_jobs` records for Phase 2 collection. However, the job's `cutoff_at` timestamp is set to next-day `00:00:00+09` (15:00 UTC).
- **Delayed Worker Claim (15:00 UTC / 00:00 KST)**: Atomic claim functions (`claim_pipeline_jobs` and `claim_specific_collection_job_v3`) strictly enforce `cutoff_at < now()`. As a result, Phase 2 collection jobs cannot be claimed or processed during the 23:55:00–23:59:59 KST window.
- **Worker Drain Loop Until 0 Jobs**: Workers processing batch jobs execute bounded claim loops (batch limit 100 for collection, 50 for downstream stages, looping up to a safety cap e.g. 20 iterations or until claimed jobs count is 0). Scheduled cron invocations trigger these worker drain calls until 0 pending/retryable jobs remain in the pipeline.
- **Re-Enqueue Before Phase 2 Drain (00:00 KST)**: Before draining Phase 2 workers at 00:00 KST, an explicit re-enqueue pass (`enqueue_collection_jobs_v3` for Phase 2 using previous KST business date `(now() AT TIME ZONE 'Asia/Seoul')::date - 1`) is re-executed to capture any newly active eligible children who sent their first message during 23:55–23:59 KST.
- **Data-Loss Prevention**: Mission II chat sessions remain active until 23:59 KST. Delaying Phase 2 collection execution until 00:00 KST ensures that all chat messages sent during the final minutes of Mission II (23:55–23:59 KST) are included in the daily raw collection snapshot without race conditions, truncation, or permanent data loss.

---

## 2. Production UTC Schedule Summary

| UTC Time | KST Time | Pipeline Stage | Target Route | Description / Payload |
|---|---|---|---|---|
| `08:55 UTC` | 17:55 KST | Phase 1 Enqueue | `/api/batch/v3/collection/enqueue` | `{"phase": 1, "targetDate": "<TODAY_KST>"}` |
| `08:56 UTC` | 17:56 KST | Phase 1 Collection Worker | `/api/batch/v3/collection/worker` | `{"phase": 1, "limit": 100}` (loops until 0 jobs, max 20 loops) |
| `14:55 UTC` | 23:55 KST | Phase 2 Enqueue | `/api/batch/v3/collection/enqueue` | `{"phase": 2, "targetDate": "<TODAY_KST>"}` (cutoff set to 00:00 KST) |
| `15:00 UTC` | 00:00 KST | Phase 2 Re-Enqueue | `/api/batch/v3/collection/enqueue` | Re-enqueues active 23:55-23:59 universe for previous KST business date `{"phase": 2, "targetDate": "<YESTERDAY_KST>"}` |
| `15:01 UTC` | 00:01 KST | Phase 2 Collection Worker | `/api/batch/v3/collection/worker` | Claims & drains Phase 2 collection jobs until 0 jobs remain `{"phase": 2, "limit": 100}` |
| `15:05 UTC` | 00:05 KST | Context Correction Worker | `/api/batch/v3/context-correction/worker` | Processes context correction for completed Phase 2 jobs (limit 50, drains until 0 jobs) |
| `15:20 UTC` | 00:20 KST | Memory Worker | `/api/batch/v3/memory/worker` | Updates long-term child memory profiles (limit 50, drains until 0 jobs) |
| `15:35 UTC` | 00:35 KST | Daily Report Worker | `/api/batch/v3/daily-report/worker` | Generates parent daily reports (limit 50, drains until 0 jobs) |
| `16:00 UTC` | 01:00 KST | Cleanup & Retention Worker | `/api/batch/v3/cleanup/worker` & `/api/batch/v3/retention/worker` | Purges expired scratch logs & enforces retention policies |

---

## 3. Legacy Cron Inventory & Cutover Strategy

### Legacy Cron Inventory (To Be Unscheduled / Disabled)
The following legacy cron jobs in `cron.job` must be explicitly unscheduled before registering V3 pipeline schedules:
1. `kbestie-dev-collection-batch-1` (Legacy dev phase 1 collection)
2. `kbestie-dev-collection-batch-2` (Legacy dev phase 2 collection)
3. `kbestie-collection-batch` (Legacy collection cron)
4. `kbestie-daily-batch` (Legacy daily batch)
5. `kbestie-weekly-batch` (Legacy weekly batch)
6. `kbestie-memory-batch-1` (Legacy memory batch 1)
7. `kbestie-memory-batch-2` (Legacy memory batch 2)
8. `close-free-sessions-daily` (Legacy session closure)
9. `generate-daily-reports-daily` (Legacy daily report pipeline)
10. `generate-weekly-summary-weekly` (Legacy weekly summary)
11. `delete-expired-chat-messages-daily` (Legacy chat retention)

### Cutover Order
0. **Mandatory Pre-Cutover Snapshot**: Export existing cron jobs with `SELECT * FROM cron.job;`. This snapshot is required to exactly restore legacy jobs that have no authoritative local migration.
1. **Inventory Audit**: Query existing cron jobs with `SELECT jobid, jobname, schedule, command FROM cron.job;`.
2. **Unschedule Legacy Crons**: Execute `SELECT cron.unschedule('<job_name>');` for each legacy cron job listed in the inventory above.
3. **Validate Legacy Unscheduled**: Verify `cron.job` returns 0 legacy jobs. Old and new cron schedules MUST NEVER run together.
4. **Register V3 Crons**: Register new V3 schedules.
5. **Rollback Plan**: If V3 cron cutover encounters issues, unschedule V3 cron jobs and restore legacy cron jobs exactly as captured in Step 0.

---

## 4. Representative Fenced SQL Examples (Non-Executable Documentation)

> [!IMPORTANT]
> The SQL snippets below are provided strictly as reference examples. Do NOT execute live secrets or register schedules without prior explicit approval.

```sql
-- Fenced Reference Example ONLY - Do Not Run Automatically

-- Unschedule Legacy Crons (Complete Inventory)
SELECT cron.unschedule('kbestie-dev-collection-batch-1');
SELECT cron.unschedule('kbestie-dev-collection-batch-2');
SELECT cron.unschedule('kbestie-collection-batch');
SELECT cron.unschedule('kbestie-daily-batch');
SELECT cron.unschedule('kbestie-weekly-batch');
SELECT cron.unschedule('kbestie-memory-batch-1');
SELECT cron.unschedule('kbestie-memory-batch-2');
SELECT cron.unschedule('close-free-sessions-daily');
SELECT cron.unschedule('generate-daily-reports-daily');
SELECT cron.unschedule('generate-weekly-summary-weekly');
SELECT cron.unschedule('delete-expired-chat-messages-daily');

-- 1. Phase 1 Enqueue (08:55 UTC / 17:55 KST)
SELECT cron.schedule(
  'v3-collection-enqueue-phase1',
  '55 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_APP_DOMAIN>/api/batch/v3/collection/enqueue',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRON_SECRET>'),
    body := jsonb_build_object('phase', 1, 'targetDate', (now() AT TIME ZONE 'Asia/Seoul')::date::text)
  );
  $$
);

-- 2. Phase 1 Worker Drain (08:56 UTC / 17:56 KST)
SELECT cron.schedule(
  'v3-collection-worker-phase1',
  '56 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_APP_DOMAIN>/api/batch/v3/collection/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRON_SECRET>'),
    body := jsonb_build_object('phase', 1, 'limit', 100)
  );
  $$
);

-- 3. Phase 2 Enqueue (14:55 UTC / 23:55 KST)
SELECT cron.schedule(
  'v3-collection-enqueue-phase2',
  '55 14 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_APP_DOMAIN>/api/batch/v3/collection/enqueue',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRON_SECRET>'),
    body := jsonb_build_object('phase', 2, 'targetDate', (now() AT TIME ZONE 'Asia/Seoul')::date::text)
  );
  $$
);

-- 4a. Phase 2 Re-Enqueue (15:00 UTC / 00:00 KST)
SELECT cron.schedule(
  'v3-collection-re-enqueue-phase2',
  '0 15 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_APP_DOMAIN>/api/batch/v3/collection/enqueue',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRON_SECRET>'),
    body := jsonb_build_object('phase', 2, 'targetDate', ((now() AT TIME ZONE 'Asia/Seoul')::date - 1)::text)
  );
  $$
);

-- 4b. Phase 2 Worker Drain (15:01 UTC / 00:01 KST)
SELECT cron.schedule(
  'v3-collection-worker-phase2',
  '1 15 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_APP_DOMAIN>/api/batch/v3/collection/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRON_SECRET>'),
    body := jsonb_build_object('phase', 2, 'limit', 100)
  );
  $$
);

-- 5. Context Correction Worker Drain (15:05 UTC / 00:05 KST)
SELECT cron.schedule(
  'v3-context-correction-worker',
  '5 15 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_APP_DOMAIN>/api/batch/v3/context-correction/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRON_SECRET>'),
    body := jsonb_build_object('limit', 50)
  );
  $$
);

-- 6. Memory Worker Drain (15:20 UTC / 00:20 KST)
SELECT cron.schedule(
  'v3-memory-worker',
  '20 15 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_APP_DOMAIN>/api/batch/v3/memory/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRON_SECRET>'),
    body := jsonb_build_object('limit', 50)
  );
  $$
);

-- 7. Daily Report Worker Drain (15:35 UTC / 00:35 KST)
SELECT cron.schedule(
  'v3-daily-report-worker',
  '35 15 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_APP_DOMAIN>/api/batch/v3/daily-report/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRON_SECRET>'),
    body := jsonb_build_object('limit', 50)
  );
  $$
);

-- 8. Cleanup Worker (16:00 UTC / 01:00 KST)
SELECT cron.schedule(
  'v3-cleanup-worker',
  '0 16 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_APP_DOMAIN>/api/batch/v3/cleanup/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRON_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);

-- 9. Retention Worker (16:05 UTC / 01:05 KST)
SELECT cron.schedule(
  'v3-retention-worker',
  '5 16 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_APP_DOMAIN>/api/batch/v3/retention/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRON_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);
```

---

## 5. Rollback & Legacy Restoration Reference Plan

To unschedule V3 cron jobs and restore legacy cron jobs if necessary:

```sql
-- Step 1: Unschedule V3 Crons
SELECT cron.unschedule('v3-collection-enqueue-phase1');
SELECT cron.unschedule('v3-collection-worker-phase1');
SELECT cron.unschedule('v3-collection-enqueue-phase2');
SELECT cron.unschedule('v3-collection-re-enqueue-phase2');
SELECT cron.unschedule('v3-collection-worker-phase2');
SELECT cron.unschedule('v3-context-correction-worker');
SELECT cron.unschedule('v3-memory-worker');
SELECT cron.unschedule('v3-daily-report-worker');
SELECT cron.unschedule('v3-cleanup-worker');
SELECT cron.unschedule('v3-retention-worker');

-- Step 2: Re-register Legacy Crons if rolling back (Full Inventory)
-- RESTORE FROM PRE-CUTOVER SNAPSHOT. The exact schedules and payloads must match the exported `cron.job` rows.
-- The following are authoritative definitions from past migrations:

-- From 20260747000000 (Dev Collection)
SELECT cron.schedule('kbestie-dev-collection-batch-1', '0 9 * * *', $$ SELECT net.http_post(url := 'https://<YOUR_APP_DOMAIN>/api/batch/collection', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <BATCH_SECRET>'), body := '{}'::jsonb); $$);
SELECT cron.schedule('kbestie-dev-collection-batch-2', '59 14 * * *', $$ SELECT net.http_post(url := 'https://<YOUR_APP_DOMAIN>/api/batch/collection', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <BATCH_SECRET>'), body := '{}'::jsonb); $$);

-- From 20260711400000 (Production Edge Functions)
-- Note: 20260725500000 alters daily to '0 18 * * *'; rollback must prefer the exact PRE-CUTOVER cron.job snapshot rather than invent a final value.
SELECT cron.schedule('kbestie-daily-batch', '0 18 * * *', $$ SELECT net.http_post(url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/daily-batch', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <BATCH_SECRET>'), body := '{}'::jsonb); $$);
SELECT cron.schedule('kbestie-weekly-batch', '0 21 * * 5', $$ SELECT net.http_post(url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/weekly-batch', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <BATCH_SECRET>'), body := jsonb_build_object('forceWeekly', true)); $$);

-- From 20260734200000 (Memory)
SELECT cron.schedule('kbestie-memory-batch-1', '0 9 * * *', $$ SELECT net.http_post(url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/memory-batch', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <BATCH_SECRET>'), body := '{}'::jsonb); $$);
SELECT cron.schedule('kbestie-memory-batch-2', '59 14 * * *', $$ SELECT net.http_post(url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/memory-batch', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <BATCH_SECRET>'), body := '{}'::jsonb); $$);

-- For kbestie-collection-batch and all other legacy jobs (e.g. close-free-sessions-daily, generate-daily-reports-daily, generate-weekly-summary-weekly, delete-expired-chat-messages-daily), YOU MUST RESTORE THE EXACT COMMAND FROM YOUR PRE-CUTOVER SNAPSHOT. Do not invent endpoints, schedules, or secrets.
```

---

## 6. Deployment Verification Checklist

Before applying any production schedule changes:
- [ ] Representative approval granted.
- [ ] Database migrations applied cleanly.
- [ ] Legacy cron jobs (`kbestie-dev-collection-batch-1`, `kbestie-dev-collection-batch-2`, `kbestie-collection-batch`, `close-free-sessions-daily`, `generate-daily-reports-daily`, `generate-weekly-summary-weekly`, `delete-expired-chat-messages-daily`) unscheduled and verified empty before registering V3 crons.
- [ ] Environment variables `CRON_SECRET` / `BATCH_SECRET` configured in Supabase / Vercel.
- [ ] Registered cron jobs verified in `cron.job` table using `SELECT * FROM cron.job;`.
