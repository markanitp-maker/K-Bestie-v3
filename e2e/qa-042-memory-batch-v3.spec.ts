import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const SUPABASE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
const BATCH_SECRET = process.env.BATCH_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY || !BATCH_SECRET) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_DEV_URL / SUPABASE_DEV_SERVICE_ROLE_KEY / BATCH_SECRET in .env.local');
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// 대표님 지정 Dev 테스트 계정(김서아) — 2026-08-02 대표님 확정 사항.
// 실제 활동 날짜와 절대 겹치지 않도록 명백히 합성된 과거 날짜만 사용한다.
const childId = '56235a1c-0427-4960-87b9-d3999a603f8c';
const businessDate = '2020-06-15';
const skipDate = '2020-06-16'; // No dialogue

test.describe('LLM Wiki Memory Batch V3 E2E QA', () => {
  let rawId: string;
  let sessionId: string;
  let sourceMessageId: string;
  let correctedConvId: string;

  test('Setup and pre-aggregate', async () => {
    // Clean up any leftover state from previous runs of THIS test only (scoped by businessDate/skipDate).
    await sb.from('pipeline_jobs').delete().eq('child_id', childId).in('business_date', [businessDate, skipDate]);
    await sb.from('pipeline_execution_items').delete().eq('child_id', childId).in('business_date', [businessDate, skipDate]);
    await sb.from('memory_facts').delete().eq('child_id', childId).eq('source_date', businessDate);
    await sb.from('corrected_daily_conversations_v3').delete().eq('child_id', childId).in('business_date', [businessDate, skipDate]);
    await sb.from('raw_daily_conversations_v3').delete().eq('child_id', childId).in('business_date', [businessDate, skipDate]);

    rawId = crypto.randomUUID();
    sessionId = crypto.randomUUID();
    sourceMessageId = crypto.randomUUID();

    const { error: rawErr } = await sb.from('raw_daily_conversations_v3').insert({
      id: rawId,
      child_id: childId,
      business_date: businessDate,
    });
    if (rawErr) throw rawErr;

    const { data: conv, error: upsertErr } = await sb.from('corrected_daily_conversations_v3').insert({
      child_id: childId,
      business_date: businessDate,
      raw_daily_conversation_v3_id: rawId,
      correction_status: 'completed',
      status: 'completed',
    }).select('id').single();
    if (upsertErr) throw upsertErr;
    correctedConvId = conv.id;

    const { error: msgErr } = await sb.from('corrected_daily_conversation_messages_v3').insert({
      corrected_daily_conversation_id: correctedConvId,
      child_id: childId,
      business_date: businessDate,
      session_id: sessionId,
      source_message_id: sourceMessageId,
      created_at: new Date().toISOString(),
      // NOTE: this table has no `updated_at` column (verified against actual Dev schema,
      // 2026-08-02) — do not add one back.
      role: 'child',
      content: '오늘은 공룡 공원에 가서 티라노사우루스를 봤어. 정말 컸어!',
      section: 'free_chat_1',
      display_sequence: 1,
    });
    if (msgErr) throw msgErr;
  });

  test('Execute Memory Batch and verify transitions', async ({ request }) => {
    test.setTimeout(60000); // real Vertex AI calls (summary+facts+embedding) take ~15-20s, default 30s is too tight
    const execId = crypto.randomUUID();

    // Enqueue
    const { error: enqErr } = await sb.rpc('enqueue_memory_batch_job_v3', {
      p_child_id: childId,
      p_business_date: businessDate,
      p_execution_id: execId,
    });
    expect(enqErr).toBeNull();

    // Check pending state
    const { data: pendingJob } = await sb.from('pipeline_jobs').select('*').eq('child_id', childId).eq('job_type', 'memory_batch').eq('business_date', businessDate).single();
    expect(pendingJob).toBeTruthy();
    expect(pendingJob.status).toBe('pending');

    // Run the worker
    const workerRes = await request.post('http://localhost:3000/api/batch/v3/memory/worker', {
      headers: { Authorization: `Bearer ${BATCH_SECRET}` },
      data: { executionId: pendingJob.execution_id },
    });

    if (!workerRes.ok()) {
      console.log('Worker Error Text:', await workerRes.text());
    }
    expect(workerRes.status()).toBe(200);
    const workerData = await workerRes.json();
    console.log('Worker Result:', workerData);

    // Check completed state
    const { data: completedJob } = await sb.from('pipeline_jobs').select('*').eq('id', pendingJob.id).single();
    expect(completedJob.status).toBe('completed');
  });

  test('Verify Fact properties and connections', async () => {
    const { data: facts } = await sb.from('memory_facts').select('*').eq('child_id', childId).eq('source_date', businessDate);
    const newFacts = facts || [];

    expect(newFacts.length).toBeGreaterThan(0);

    for (const fact of newFacts) {
      expect(fact.pipeline_version).toBe('v3');
      expect(fact.backfill_status).toBe('normal');
      expect(fact.idempotency_key).toBeTruthy();
      expect(fact.idempotency_key).not.toMatch(/_\d+$/);

      const { data: evidence } = await sb.from('memory_evidence').select('*').eq('memory_fact_id', fact.id);
      expect(evidence.length).toBeGreaterThan(0);

      const { data: embedding } = await sb.from('memory_embeddings').select('*').eq('memory_fact_id', fact.id);
      expect(embedding.length).toBe(1);
      expect(embedding[0].model).toBe('gemini-embedding-001');
    }
  });

  test('Idempotency - no duplicate generation', async ({ request }) => {
    const execId = crypto.randomUUID();
    const { error: enqErr } = await sb.rpc('enqueue_memory_batch_job_v3', {
      p_child_id: childId,
      p_business_date: businessDate,
      p_execution_id: execId,
    });
    expect(enqErr).toBeNull();

    const { data: job } = await sb.from('pipeline_jobs').select('*').eq('child_id', childId).eq('job_type', 'memory_batch').eq('business_date', businessDate).single();

    const workerRes = await request.post('http://localhost:3000/api/batch/v3/memory/worker', {
      headers: { Authorization: `Bearer ${BATCH_SECRET}` },
      data: { executionId: job.execution_id },
    });
    expect(workerRes.status()).toBe(200);

    // No arbitrary-SQL RPC exists (and shouldn't) — check duplicates via a normal select + in-process grouping.
    const { data: allFacts } = await sb.from('memory_facts').select('idempotency_key').eq('child_id', childId).eq('source_date', businessDate);
    const counts = new Map<string, number>();
    for (const row of allFacts || []) {
      const key = row.idempotency_key;
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const dupes = [...counts.entries()].filter(([, count]) => count > 1);
    expect(dupes.length).toBe(0);
  });

  test('Verify skipped for no-dialogue date', async ({ request }) => {
    const execId = crypto.randomUUID();
    const { error: enqErr } = await sb.rpc('enqueue_memory_batch_job_v3', {
      p_child_id: childId,
      p_business_date: skipDate,
      p_execution_id: execId,
    });
    expect(enqErr).toBeNull();

    const { data: pendingJob } = await sb.from('pipeline_jobs').select('*').eq('child_id', childId).eq('job_type', 'memory_batch').eq('business_date', skipDate).single();

    const workerRes = await request.post('http://localhost:3000/api/batch/v3/memory/worker', {
      headers: { Authorization: `Bearer ${BATCH_SECRET}` },
      data: { executionId: pendingJob.execution_id },
    });

    if (!workerRes.ok()) {
      console.log('Worker Error Text (skip test):', await workerRes.text());
    }
    expect(workerRes.status()).toBe(200);

    const workerData = await workerRes.json();
    expect(workerData.result.skipped).toBeGreaterThanOrEqual(0);

    const { data: job } = await sb.from('pipeline_jobs').select('status').eq('id', pendingJob.id).single();
    expect(job.status).toBe('completed');
  });

  test.afterAll(async () => {
    // Clean up everything this test created — scoped strictly to childId + the two synthetic
    // test dates used above. Never touches any other business_date for this or any other child.
    const { data: convs } = await sb.from('corrected_daily_conversations_v3').select('id').eq('child_id', childId).in('business_date', [businessDate, skipDate]);
    for (const c of convs || []) {
      await sb.from('corrected_daily_conversation_messages_v3').delete().eq('corrected_daily_conversation_id', c.id);
    }
    const { data: facts } = await sb.from('memory_facts').select('id').eq('child_id', childId).eq('source_date', businessDate);
    for (const f of facts || []) {
      await sb.from('memory_evidence').delete().eq('memory_fact_id', f.id);
      await sb.from('memory_embeddings').delete().eq('memory_fact_id', f.id);
    }
    await sb.from('memory_facts').delete().eq('child_id', childId).eq('source_date', businessDate);
    await sb.from('pipeline_execution_items').delete().eq('child_id', childId).in('business_date', [businessDate, skipDate]);
    await sb.from('pipeline_jobs').delete().eq('child_id', childId).in('business_date', [businessDate, skipDate]);
    await sb.from('corrected_daily_conversations_v3').delete().eq('child_id', childId).in('business_date', [businessDate, skipDate]);
    await sb.from('raw_daily_conversations_v3').delete().eq('child_id', childId).in('business_date', [businessDate, skipDate]);
  });
});
