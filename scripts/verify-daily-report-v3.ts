import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { processDailyReportJobsV3 } from '../lib/batch/dailyReportV3';
import * as crypto from 'crypto';

dotenv.config({ path: '.env.local' });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!, process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!);

const uuid = crypto.randomUUID;
const childId = 'cb96a208-e3d9-4693-b476-bf077269844e';
const execId = 'a3333333-3333-3333-3333-333333333333';
const date = '2026-08-01';
const convId = 'b4444444-4444-4444-4444-444444444444';

async function cleanup() {
    await db.from('pipeline_jobs').delete().eq('child_id', childId);
    await db.from('daily_reports').delete().eq('child_id', childId);
    await db.from('corrected_daily_conversation_messages_v3').delete().eq('corrected_daily_conversation_id', convId);
    await db.from('corrected_daily_conversations_v3').delete().eq('id', convId);
    await db.from('raw_daily_conversations_v3').delete().eq('id', convId);
    await db.from('child_profiles').delete().eq('id', childId);
}

async function run() {
  await cleanup();
  
  // 1. Setup test data
  try {
    await db.auth.admin.createUser({
        email: 'test_child_report@kbestie.local',
        email_confirm: true,
        password: 'password123'
    });
  } catch (e) {}
  // wait for it
  
  const { data: userList } = await db.auth.admin.listUsers();
  const testUser = userList.users.find(u => u.email === 'test_child_report@kbestie.local');
  const validChildId = testUser ? testUser.id : childId;
  
  await db.from('child_profiles').insert({ id: validChildId, name: 'Test Child' });
  await db.from('pipeline_v3_control').update({ enabled: true, cutover_at: new Date().toISOString() }).eq('id', 1);

  await db.from('raw_daily_conversations_v3').insert({
    id: convId,
    child_id: validChildId,
    business_date: date,
  });

  const { error: convErr } = await db.from('corrected_daily_conversations_v3').insert({
    id: convId,
    raw_daily_conversation_v3_id: convId, // mocking same ID
    child_id: validChildId,
    business_date: date,
    correction_status: 'completed',
    corrected_message_count: 2
  });
  if (convErr) console.error('Conv Insert Error:', convErr.message);

  const { error: msgErr } = await db.from('corrected_daily_conversation_messages_v3').insert([
    {
      id: uuid(),
      corrected_daily_conversation_id: convId,
      source_message_id: uuid(),
      role: 'child',
      content: '오늘은 유치원에서 친구랑 숨바꼭질 했어.',
      section: 'free_chat_1',
      display_sequence: 1
    },
    {
      id: uuid(),
      corrected_daily_conversation_id: convId,
      source_message_id: uuid(),
      role: 'kchat',
      content: '우와 재미있었겠다! 친구 이름이 뭐야?',
      section: 'free_chat_1',
      display_sequence: 2
    }
  ]);
  if (msgErr) console.error('Msg Insert Error:', msgErr.message);

  console.log('Running Daily Report Job...');
  const jobId = uuid();
  const { error: insErr } = await db.from('pipeline_jobs').insert({
      id: jobId,
      job_type: 'daily_report',
      child_id: validChildId,
      business_date: date,
      execution_id: execId,
      status: 'pending',
      idempotency_key: 'test-report-idem-1'
  });
  if (insErr) console.error('Job Insert Error:', insErr.message);
  
  const res1 = await processDailyReportJobsV3(10, 'worker-1');
  console.log('Process Daily Report result:', res1);
  
  const { data: rep } = await db.from('daily_reports').select('*').eq('child_id', validChildId);
  console.log('Daily Reports Created:', rep?.length);
  if (rep?.length > 0) {
    console.log('Report mood score:', rep[0].mood_score);
    console.log('Report content hidden:', !rep[0].summary_line.includes('숨바꼭질')); 
  }

  const { data: corr } = await db.from('corrected_daily_conversations_v3').select('report_generated_at').eq('id', convId).single();
  console.log('report_generated_at set:', !!corr?.report_generated_at);

  const { data: job } = await db.from('pipeline_jobs').select('status').eq('id', jobId).single();
  console.log('Job status:', job?.status);

  console.log('Running Daily Report Job Dup...');
  const { error: insErr2 } = await db.from('pipeline_jobs').insert({
      id: uuid(),
      job_type: 'daily_report',
      child_id: validChildId,
      business_date: date,
      execution_id: execId,
      status: 'pending',
      idempotency_key: 'test-report-idem-2'
  });
  if (insErr2) console.error('Job Insert Error 2:', insErr2.message);
  
  const res2 = await processDailyReportJobsV3(10, 'worker-1');
  console.log('Process Daily Report Dup result:', res2);
  const { data: rep2 } = await db.from('daily_reports').select('*').eq('child_id', validChildId);
  console.log('Daily Reports Dup Count:', rep2?.length);

  // Error condition: no messages
  console.log('Testing no messages error isolation...');
  await db.from('pipeline_jobs').delete().eq('child_id', validChildId);
  await db.from('corrected_daily_conversation_messages_v3').delete().eq('conversation_id', convId);
  await db.from('corrected_daily_conversations_v3').update({ corrected_message_count: 0 }).eq('id', convId);

  const failJobId = uuid();
  await db.from('pipeline_jobs').insert({
      id: failJobId,
      job_type: 'daily_report',
      child_id: validChildId,
      business_date: date,
      execution_id: execId,
      status: 'pending',
      idempotency_key: 'test-report-idem-3'
  });
  const resFail = await processDailyReportJobsV3(10, 'worker-1');
  console.log('Process Daily Report Fail result:', resFail);
  const { data: failJob } = await db.from('pipeline_jobs').select('status').eq('id', failJobId).single();
  console.log('Fail Job status (should be failed due to PERMANENT_FAIL):', failJob?.status);

  // Cleanup
  await db.from('pipeline_jobs').delete().eq('child_id', validChildId);
  await db.from('daily_reports').delete().eq('child_id', validChildId);
  await db.from('corrected_daily_conversation_messages_v3').delete().eq('conversation_id', convId);
  await db.from('corrected_daily_conversations_v3').delete().eq('id', convId);
  await db.from('raw_daily_conversations_v3').delete().eq('id', convId);
  await db.from('child_profiles').delete().eq('id', validChildId);
  try {
    await db.auth.admin.deleteUser(validChildId);
  } catch(e) {}
  await db.from('pipeline_v3_control').update({ enabled: false, cutover_at: null }).eq('id', 1);
}

run().catch(console.error);
