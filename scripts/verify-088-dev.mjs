import dotenv from "dotenv";

dotenv.config({ path: process.env.KBESTIE_ENV_FILE ?? ".env.local", quiet: true });

const projectRef = "mkrsaaedxqrcrktapaus";
if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN missing");

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`Dev query failed: ${response.status} ${await response.text()}`);
  return response.json();
}

const rows = await query(`
  with defs as (
    select
      pg_get_functiondef('public.enqueue_collection_jobs_v3(integer,date,uuid,uuid,timestamptz,boolean,boolean)'::regprocedure) as enqueue_def,
      pg_get_functiondef('public.reconcile_pipeline_v3(date,uuid)'::regprocedure) as reconcile_def,
      pg_get_functiondef('public.ensure_collection_1_zero_marker_v3(uuid,date,uuid,integer)'::regprocedure) as marker_def,
      pg_get_functiondef('public.complete_context_correction_job_v3_no_conversation(uuid,text)'::regprocedure) as zero_def,
      pg_get_functiondef('public.complete_memory_batch_job_v3(uuid,text,text)'::regprocedure) as memory_complete_def,
      pg_get_functiondef('public.enqueue_pipeline_job_v3(text,uuid,date,uuid,integer,timestamptz)'::regprocedure) as job_def
  ), fixture(name, c1_completed, uncollected_before, uncollected_after, c2_exists) as (
    values
      ('phase1_only', true, 5, 0, false),
      ('night_only', false, 0, 7, false),
      ('both_windows', true, 4, 6, false)
  ), candidates as (
    select name,
      (c1_completed or uncollected_before > 0 or uncollected_after > 0) and not c2_exists as is_candidate
    from fixture
  ), duplicate_groups as (
    select count(*)::int as n
    from (
      select child_id, business_date, job_type, generation_version
      from public.pipeline_jobs
      group by child_id, business_date, job_type, generation_version
      having count(*) > 1
    ) d
  )
  select * from (
    select 1 as scenario, 'C1=N/C2=0 candidate' as label,
      coalesce((select is_candidate from candidates where name='phase1_only'), false) as pass
    union all
    select 2, 'C1=0/C2=N candidate and marker',
      coalesce((select is_candidate from candidates where name='night_only'), false)
      and position('ensure_collection_1_zero_marker_v3' in (select enqueue_def from defs)) > 0
      and position('NORMALIZED_ZERO' in (select marker_def from defs)) > 0
    union all
    select 3, 'C1=N/C2=N candidate',
      coalesce((select is_candidate from candidates where name='both_windows'), false)
    union all
    select 4, 'C2=0 downstream terminal without LLM',
      position('memory_batch' in (select zero_def from defs)) > 0
      and position('daily_report' in (select zero_def from defs)) > 0
      and position('NO_CONVERSATION' in (select zero_def from defs)) > 0
      and exists(select 1 from pg_trigger where tgname='trg_sync_completed_collection_2_raw_status_v3' and not tgisinternal)
    union all
    select 5, 'repeated enqueue/poll duplicate zero',
      exists(select 1 from pg_indexes where schemaname='public' and indexname='uq_pipeline_jobs_child_date_type_generation')
      and (select n from duplicate_groups) = 0
      and position('ALREADY_COMPLETED' in (select memory_complete_def from defs)) > 0
    union all
    select 6, 'missed 23:55 cron reconciliation',
      position('candidates AS' in (select reconcile_def from defs)) > 0
      and position('collection_2' in (select reconcile_def from defs)) > 0
      and position('NOT EXISTS' in (select reconcile_def from defs)) > 0
      and position('enqueue_pipeline_job_v3' in (select reconcile_def from defs)) > 0
    union all
    select 7, 'transient worker failure retry',
      position('failed' in (select reconcile_def from defs)) > 0
      and position('v_job_status' in (select job_def from defs)) > 0
      and position('attempt_count = 0' in (select job_def from defs)) > 0
      and position('next_retry_at = now()' in (select job_def from defs)) > 0
  ) checks
  order by scenario;
`);

for (const row of rows) {
  if (!row.pass) throw new Error(`Scenario ${row.scenario} failed: ${row.label}`);
  console.log(`PASS ${row.scenario}/7 ${row.label}`);
}
