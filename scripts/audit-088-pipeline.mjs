import dotenv from "dotenv";

dotenv.config({ path: process.env.KBESTIE_ENV_FILE ?? ".env.local", quiet: true });

const target = process.argv[2];
const refs = { development: "mkrsaaedxqrcrktapaus", production: "fetvnhhjicndmxvhrffk" };
const projectRef = refs[target];
if (!projectRef || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error("target or access token missing");

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`query failed: ${response.status} ${await response.text()}`);
  return response.json();
}

const schema = await query(`
  select
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='pipeline_jobs' and column_name='generation_version') as has_generation_version,
    (select count(*) from (
      select child_id, business_date, job_type, count(*)
      from public.pipeline_jobs
      group by child_id, business_date, job_type
      having count(*) > 1
    ) d) as duplicate_job_groups;
`);

const qaAccounts = await query(`
  select cp.name, au.email
  from auth.users au
  join public.family_members fm on fm.user_id=au.id and fm.role='child'
  join public.child_profiles cp on cp.member_id=fm.id
  where lower(au.email) in ('testa@kbestie.local','testb@kbestie.local')
  order by au.email;
`);

const states = await query(`
  with dates as (
    select generate_series(((now() at time zone 'Asia/Seoul')::date - 7), ((now() at time zone 'Asia/Seoul')::date - 1), interval '1 day')::date as business_date
  ), source as (
    select s.child_id, (m.created_at at time zone 'Asia/Seoul')::date as business_date, count(*)::int as source_count
    from public.chat_messages m
    join public.chat_sessions s on s.id=m.session_id
    where (m.created_at at time zone 'Asia/Seoul')::date between ((now() at time zone 'Asia/Seoul')::date - 7) and ((now() at time zone 'Asia/Seoul')::date - 1)
    group by s.child_id, (m.created_at at time zone 'Asia/Seoul')::date
  ), targets as (
    select cp.id as child_id, cp.name, d.business_date, coalesce(src.source_count,0) as source_count
    from public.child_profiles cp cross join dates d
    left join source src on src.child_id=cp.id and src.business_date=d.business_date
    where src.source_count > 0
  ), jobs as (
    select child_id,business_date,
      max(status) filter(where job_type='collection_1') as c1,
      max(status) filter(where job_type='collection_2') as c2,
      max(status) filter(where job_type='context_correction') as correction,
      max(status) filter(where job_type='memory_batch') as memory,
      max(status) filter(where job_type='daily_report') as report
    from public.pipeline_jobs
    where business_date between ((now() at time zone 'Asia/Seoul')::date - 7) and ((now() at time zone 'Asia/Seoul')::date - 1)
    group by child_id,business_date
  )
  select t.name, t.business_date, t.source_count,
    coalesce(j.c1::text,'missing') as c1, coalesce(j.c2::text,'missing') as c2,
    coalesce(r.collection_2_status::text,'missing') as raw_finalized,
    coalesce(j.correction::text,'missing') as correction,
    coalesce(j.memory::text,'missing') as memory,
    coalesce(j.report::text,'missing') as report
  from targets t
  left join jobs j using(child_id,business_date)
  left join public.raw_daily_conversations_v3 r using(child_id,business_date)
  where j.c2 is null
     or (j.c2='completed' and coalesce(r.collection_2_status,'') <> 'completed')
     or (j.c2='completed' and r.collection_2_status='completed' and j.correction is null)
     or (j.correction='completed' and j.memory is null)
     or (j.correction='completed' and j.report is null)
  order by t.business_date,t.name;
`);

const named = await query(`
  with wanted(name) as (values ('윤도건'),('윤도원'),('안서아'),('안서현')),
  jobs as (
    select child_id,business_date,
      max(status) filter(where job_type='collection_1') as c1,
      max(status) filter(where job_type='collection_2') as c2,
      max(status) filter(where job_type='context_correction') as correction,
      max(status) filter(where job_type='memory_batch') as memory,
      max(status) filter(where job_type='daily_report') as report
    from public.pipeline_jobs
    where business_date between ((now() at time zone 'Asia/Seoul')::date - 7) and ((now() at time zone 'Asia/Seoul')::date - 1)
    group by child_id,business_date
  ), counts as (
    select collection_job_id, count(*)::int as message_count
    from public.raw_daily_conversation_messages_v3 group by collection_job_id
  )
  select cp.name,j.business_date,j.c1,
    coalesce((select c.message_count from public.pipeline_jobs p left join counts c on c.collection_job_id=p.id where p.child_id=cp.id and p.business_date=j.business_date and p.job_type='collection_1' limit 1),0) as c1_count,
    j.c2,
    coalesce((select c.message_count from public.pipeline_jobs p left join counts c on c.collection_job_id=p.id where p.child_id=cp.id and p.business_date=j.business_date and p.job_type='collection_2' limit 1),0) as c2_count,
    r.collection_2_status as raw_finalized,j.correction,j.memory,j.report
  from public.child_profiles cp join wanted w on w.name=cp.name
  join jobs j on j.child_id=cp.id
  left join public.raw_daily_conversations_v3 r on r.child_id=cp.id and r.business_date=j.business_date
  order by j.business_date,cp.name;
`);

const duplicates = await query(`
  select
    (select count(*) from (select source_message_id from public.raw_daily_conversation_messages_v3 group by source_message_id having count(*) > 1) d) as raw_messages,
    (select count(*) from (select source_message_id from public.corrected_daily_conversation_messages_v3 group by source_message_id having count(*) > 1) d) as corrected_messages,
    (select count(*) from (select idempotency_key from public.memory_facts where idempotency_key is not null group by idempotency_key having count(*) > 1) d) as memory_facts,
    (select count(*) from (select memory_fact_id, source_date from public.memory_evidence where source_date is not null group by memory_fact_id, source_date having count(*) > 1) d) as memory_evidence,
    (select count(*) from (select memory_fact_id, model from public.memory_embeddings group by memory_fact_id, model having count(*) > 1) d) as memory_embeddings,
    (select count(*) from (select child_id, business_date from public.daily_reports group by child_id, business_date having count(*) > 1) d) as daily_reports;
`);

console.log(JSON.stringify({ target, schema: schema[0], qaAccounts, affected: states, named, duplicates: duplicates[0] }, null, 2));
