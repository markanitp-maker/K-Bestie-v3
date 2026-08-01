import { createServiceClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";

export function isValidDateString(dateStr: string): boolean {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === dateStr;
}

/**
 * Legacy compatibility entry point for collection pipeline.
 * Delegates entirely to V3 enqueue + worker job flow and never updates raw tables directly.
 */
export async function runCollectionPipeline(targetDate: string, isSecondRun: boolean = false) {
  if (!isValidDateString(targetDate)) {
    throw new Error("Invalid targetDate: must be a real YYYY-MM-DD date string");
  }
  if (typeof isSecondRun !== "boolean") {
    throw new Error("Invalid isSecondRun: must be a boolean");
  }

  const phase: 1 | 2 = isSecondRun ? 2 : 1;
  const executionId = randomUUID();
  const workerId = `legacy_compat_${randomUUID()}`;

  const enqueueResult = await enqueueCollectionJobsV3(targetDate, phase, executionId);
  const workerResult = await processCollectionJobsV3(phase, 100, workerId);

  return {
    success: true,
    phase,
    targetDate,
    executionId,
    enqueue: enqueueResult,
    worker: workerResult,
  };
}

/**
 * Phase 2A: v3 Collection Job Enqueue
 * Creates collection jobs atomically via RPC.
 */
/**
 * Phase 2A: v3 Collection Job Enqueue
 * Creates collection jobs atomically via RPC.
 */
export async function enqueueCollectionJobsV3(targetDate: string, phase: 1 | 2, executionId: string, childId?: string, cutoffAt?: string) {
  if (!isValidDateString(targetDate)) {
    throw new Error("Invalid targetDate: must be a real YYYY-MM-DD date string");
  }
  if (phase !== 1 && phase !== 2) {
    throw new Error("Invalid phase: must be 1 or 2");
  }
  if (!executionId || typeof executionId !== "string") {
    throw new Error("Invalid executionId: must be a non-empty string");
  }

  const db = createServiceClient();
  
  const { data, error } = await db.rpc('enqueue_collection_jobs_v3', {
    p_collection_phase: phase,
    p_business_date: targetDate,
    p_execution_id: executionId,
    p_child_id: childId || null,
    p_cutoff_at: cutoffAt || null,
    p_include_downstream: phase === 2
  });

  if (error) {
    if (error.message === 'V3_DISABLED') {
      throw new Error('V3 is disabled');
    }
    throw new Error(`Enqueue RPC failed: ${error.message}`);
  }
  
  return { 
    enqueued_jobs: data?.[0]?.enqueued_count || 0, 
    existing_jobs: data?.[0]?.existing_count || 0,
    cutoff_at: data?.[0]?.cutoff_at
  };
}

/**
 * Phase 2A: v3 Worker Process Layer
 * Claims available jobs and processes them via RPC.
 */
export async function processCollectionJobsV3(phase: 1 | 2, limit: number, workerId: string, executionId?: string) {
  if (phase !== 1 && phase !== 2) {
    throw new Error("Invalid phase: must be 1 or 2");
  }
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid limit: must be an integer between 1 and 100");
  }
  if (!workerId || typeof workerId !== "string") {
    throw new Error("Invalid workerId: must be a non-empty string");
  }

  const db = createServiceClient();

  const rpcName = executionId ? 'claim_collection_jobs_v3_for_execution' : 'claim_pipeline_jobs';
  const rpcParams: any = {
    p_claimed_by: workerId,
    p_limit: limit,
    p_collection_phase: phase
  };
  if (executionId) {
    rpcParams.p_execution_id = executionId;
  }

  const { data: claimedJobs, error: claimError } = await db.rpc(rpcName, rpcParams);

  if (claimError) throw new Error(`Failed to claim jobs: ${claimError.message}`);
  
  if (!claimedJobs || claimedJobs.length === 0) {
    return { claimed: 0, completed: 0, errors: [] };
  }

  const results = { claimed: claimedJobs.length, completed: 0, errors: [] as any[] };

  for (const job of claimedJobs) {
    try {
      const { error: rpcError } = await db.rpc('collect_chat_messages_v3', {
        p_job_id: job.id,
        p_claimed_by: workerId
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      results.completed++;
    } catch (err: any) {
      console.error(`[Worker] Failed to process job ${job.id}`);
      const { error: markFailErr } = await db.rpc('mark_pipeline_job_failed_v3', {
        p_job_id: job.id,
        p_claimed_by: workerId,
        p_error_code: 'WORKER_ERR',
        p_error_summary: err.message ? err.message.substring(0, 100) : 'Unknown error',
        p_retryable: true
      });
      if (markFailErr) {
        console.error(`[Worker] Failed to mark job failed: ${markFailErr.message}`);
      }
      
      results.errors.push({ job_id: job.id, error: err.message });
    }
  }

  return results;
}

/**
 * Phase 2A: Manual Specific Job Processing
 * Claims and processes a collection job for a specific child synchronously via SECURITY DEFINER RPC.
 */
export async function processSpecificCollectionJobV3(phase: 1 | 2, childId: string, businessDate: string, workerId: string) {
  if (phase !== 1 && phase !== 2) {
    throw new Error("Invalid phase: must be 1 or 2");
  }
  if (!childId || typeof childId !== "string") {
    throw new Error("Invalid childId: must be a non-empty string");
  }
  if (!isValidDateString(businessDate)) {
    throw new Error("Invalid businessDate: must be a real YYYY-MM-DD date string");
  }
  if (!workerId || typeof workerId !== "string") {
    throw new Error("Invalid workerId: must be a non-empty string");
  }

  const db = createServiceClient();
  
  // 1. Atomic Specific Claim RPC
  const { data: jobs, error: claimErr } = await db.rpc('claim_specific_collection_job_v3', {
    p_collection_phase: phase,
    p_child_id: childId,
    p_business_date: businessDate,
    p_claimed_by: workerId
  });
    
  if (claimErr) throw new Error(`Claim failed: ${claimErr.message}`);
  if (!jobs || jobs.length === 0) return { success: false, reason: 'NO_PENDING_JOB' };
  
  const job = jobs[0];
  
  // 2. Process (DB RPC collect_chat_messages_v3 handles collection and durable context correction enqueue)
  try {
    const { error: rpcError } = await db.rpc('collect_chat_messages_v3', {
      p_job_id: job.id,
      p_claimed_by: workerId
    });

    if (rpcError) throw new Error(rpcError.message);
    
    return { success: true, job_id: job.id };
  } catch (err: any) {
    await db.rpc('mark_pipeline_job_failed', {
      p_job_id: job.id,
      p_claimed_by: workerId,
      p_error_code: 'WORKER_ERR',
      p_error_summary: err.message ? err.message.substring(0, 100) : 'Unknown error',
      p_retryable: true
    });
    return { success: false, reason: err.message || 'Worker error' };
  }
}
