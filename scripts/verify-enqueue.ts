import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { processCollectionJobsV3 } from '../lib/batch/collection';
import * as crypto from 'crypto';

dotenv.config({ path: '.env.local' });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!, process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!);

const uuid = crypto.randomUUID;

// We use hardcoded UUIDs that are fresh and valid in auth.users
const childId = 'cb96a208-e3d9-4693-b476-bf077269844e';
const execId = 'a3333333-3333-3333-3333-333333333333';
const date = '2026-08-01';

async function cleanup() {
    await db.from('pipeline_jobs').delete().eq('child_id', childId);
    await db.from('corrected_daily_conversation_messages_v3').delete().eq('child_id', childId);
    await db.from('corrected_daily_conversations_v3').delete().eq('child_id', childId);
    await db.from('raw_daily_conversation_messages_v3').delete().eq('child_id', childId);
    await db.from('raw_daily_conversations_v3').delete().eq('child_id', childId);
    await db.from('child_profiles').delete().eq('id', childId);
}

async function run() {
  await cleanup();
  
  await db.from('child_profiles').insert({ id: childId, name: 'Test Child' });
  await db.from('pipeline_v3_control').update({ enabled: true, cutover_at: new Date().toISOString() }).eq('id', 1);
  
  console.log('Running Collection 1 (via direct job insert)...');
  await db.from('pipeline_jobs').insert({
      id: uuid(),
      job_type: 'collection_1',
      child_id: childId,
      business_date: date,
      execution_id: execId,
      status: 'pending',
      idempotency_key: 'test-idem-1'
  });
  
  const res1 = await processCollectionJobsV3(1, 10, 'worker-1');
  console.log('Process Collection 1 result:', res1);
  
  const { count: c1 } = await db.from('pipeline_jobs').select('*', { count: 'exact' }).eq('job_type', 'context_correction').eq('child_id', childId);
  console.log('Collection 1 Correction Jobs:', c1); // Expect 0
  
  console.log('Running Collection 2...');
  
  await db.from('pipeline_jobs').insert({
      id: uuid(),
      job_type: 'collection_2',
      child_id: childId,
      business_date: date,
      execution_id: execId,
      status: 'pending',
      idempotency_key: 'test-idem-2'
  });
  
  const res2 = await processCollectionJobsV3(2, 10, 'worker-1');
  console.log('Process Collection 2 result:', res2);
  
  let { count: c2 } = await db.from('pipeline_jobs').select('*', { count: 'exact' }).eq('job_type', 'context_correction').eq('child_id', childId);
  console.log('Collection 2 Correction Jobs (No Raw V3):', c2); // Expect 0
  
  console.log('Running Collection 2 with Raw V3...');
  await db.from('raw_daily_conversations_v3').insert({ id: uuid(), child_id: childId, business_date: date, collection_status: 'complete', collection_phase: 2 });
  
  await db.from('pipeline_jobs').insert({
      id: uuid(),
      job_type: 'collection_2',
      child_id: childId,
      business_date: date,
      execution_id: execId,
      status: 'pending',
      idempotency_key: 'test-idem-3'
  });
  
  const res3 = await processCollectionJobsV3(2, 10, 'worker-1');
  console.log('Process Collection 2 result (With Raw V3):', res3);
  
  const { count: c3 } = await db.from('pipeline_jobs').select('*', { count: 'exact' }).eq('job_type', 'context_correction').eq('child_id', childId);
  console.log('Collection 2 Correction Jobs (With Raw V3):', c3); // Expect 1
  
  console.log('Running Collection 2 Dup (Re-enqueue should yield 1)...');
  await db.from('pipeline_jobs').insert({
      id: uuid(),
      job_type: 'collection_2',
      child_id: childId,
      business_date: date,
      execution_id: execId,
      status: 'pending',
      idempotency_key: 'test-idem-4'
  });
  const res4 = await processCollectionJobsV3(2, 10, 'worker-1');
  console.log('Process Collection 2 Dup result:', res4);
  const { count: c4 } = await db.from('pipeline_jobs').select('*', { count: 'exact' }).eq('job_type', 'context_correction').eq('child_id', childId);
  console.log('Collection 2 Dup Correction Jobs:', c4); // Expect 1
  
  console.log('Collection 실패 테스트...');
  // processCollectionJobsV3 handles failures internally if RPC throws
  await db.from('pipeline_jobs').insert({
      id: uuid(),
      job_type: 'collection_2',
      child_id: 'cb96a208-e3d9-4693-b476-bf077269844e', 
      business_date: date,
      execution_id: null, // this will fail enqueue intentionally to test failure isolation
      status: 'pending',
      idempotency_key: 'test-idem-5'
  });
  
  const resFail = await processCollectionJobsV3(2, 10, 'worker-1');
  console.log('Process Collection Fail Result:', resFail);
  const { count: failCount } = await db.from('pipeline_jobs').select('*', { count: 'exact' }).eq('job_type', 'context_correction').eq('child_id', 'cb96a208-e3d9-4693-b476-bf077269844e');
  console.log('Correction Jobs on Failure:', failCount); // Expect 1 still (from previous run)
  
  // Cleanup
  await cleanup();
  await db.auth.admin.deleteUser(childId);
  await db.from('pipeline_v3_control').update({ enabled: false, cutover_at: null }).eq('id', 1);
}

run().catch(console.error);
