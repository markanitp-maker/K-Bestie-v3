import { createServiceClient } from "@/lib/supabase/server";
import {
  generateMemorySummaries,
  generateMemoryFacts,
  type MemorySummaryResult,
  type MemoryFactBatchResult,
} from "@/lib/batch/generateMemory";
import type { SupabaseClient } from "@supabase/supabase-js";
// 020 §3-11 — 잡 사이에 짧은 간격을 둬 Vertex 요청이 같은 순간에 몰리지 않게 한다.
import { throttleBetweenBatchLlmJobs } from "./llmThrottle";
import { isRetryableTransportError } from "./retryPolicy";

export type MemoryExecutionResult = {
  status: "completed" | "skipped" | "failed";
  childId: string;
  businessDate: string;
  error?: string;
};

export interface MemoryBatchDependencies {
  db?: SupabaseClient;
  generateSummaries?: (
    db: SupabaseClient,
    targetDate: string,
    targetChildId?: string
  ) => Promise<MemorySummaryResult>;
  generateFacts?: (
    db: SupabaseClient,
    targetDate: string,
    targetChildId?: string
  ) => Promise<MemoryFactBatchResult>;
}

export async function executeMemoryBatchForChildDate(
  childId: string,
  businessDate: string,
  deps?: MemoryBatchDependencies
): Promise<MemoryExecutionResult> {
  const db = deps?.db ?? createServiceClient();
  const runSummaries = deps?.generateSummaries ?? generateMemorySummaries;
  const runFacts = deps?.generateFacts ?? generateMemoryFacts;

  const result = await runSummaries(db, businessDate, childId);

  let memoryFacts: Partial<MemoryFactBatchResult> & { error?: string } = { skipped: [] };
  try {
    memoryFacts = await runFacts(db, businessDate, childId);
  } catch (e) {
    console.error("[memory-batch] generateMemoryFacts 실패:", e);
    memoryFacts = {
      error: String(e),
      errors: childId ? [{ childId, error: String(e) }] : [],
    };
  }

  // Inspect payload-level errors
  const childErr = (result.errors || []).find((e: any) => e.childId === childId);
  if (childErr) {
    throw new Error(`Memory summary failed for child: ${childErr.error}`);
  }

  const factErrors = memoryFacts?.errors || [];
  const factChildErr = factErrors.find((e: any) => e.childId === childId);
  if (factChildErr) {
    throw new Error(`Memory facts failed for child: ${factChildErr.error}`);
  }

  if (memoryFacts?.error && typeof memoryFacts.error === "string") {
    throw new Error(`Memory facts error: ${memoryFacts.error}`);
  }

  if (Array.isArray(result.childrenProcessed) && result.childrenProcessed.includes(childId)) {
    return { status: "completed", childId, businessDate };
  }

  // If child was skipped or not in childrenProcessed (e.g. no sessions)
  return { status: "skipped", childId, businessDate };
}

export async function runMemoryBatchWorkerV3(limit: number, workerId?: string, executionId?: string) {
  const db = createServiceClient();
  const wId = workerId || `memory-worker-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const summary = {
    claimed: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    errors: [] as any[],
  };

  const rpcName = executionId ? "claim_memory_batch_jobs_v3_for_execution" : "claim_memory_batch_jobs_v3";
  const rpcParams: any = {
    p_claimed_by: wId,
    p_limit: limit,
  };
  if (executionId) {
    rpcParams.p_execution_id = executionId;
  }

  const { data: jobs, error: claimErr } = await db.rpc(rpcName, rpcParams);

  if (claimErr) {
    throw new Error(`Failed to claim memory_batch jobs: ${claimErr.message}`);
  }

  if (!jobs || jobs.length === 0) {
    return summary;
  }
  summary.claimed = jobs.length;

  // 020 §3-11 — 첫 잡 앞에서는 기다리지 않는다. 잡을 하나 끝낸 뒤에만 간격을 둔다.
  let isFirstJob = true;
  for (const job of jobs) {
    if (!isFirstJob) {
      await throttleBetweenBatchLlmJobs();
    }
    isFirstJob = false;
    try {
      const execRes = await executeMemoryBatchForChildDate(job.child_id, job.business_date);

      if (execRes.status === "completed" || execRes.status === "skipped") {
        const note = execRes.status === "skipped" ? "SKIPPED" : null;
        const { error: compErr } = await db.rpc("complete_memory_batch_job_v3", {
          p_job_id: job.id,
          p_claimed_by: wId,
          p_summary_note: note,
        });

        if (compErr) {
          throw new Error(`Failed to mark memory job complete: ${compErr.message}`);
        }

        if (execRes.status === "completed") {
          summary.success++;
        } else {
          summary.skipped++;
        }
      }
    } catch (err: any) {
      summary.failed++;
      const errMsg = err.message || "Unknown error";
      summary.errors.push({ job_id: job.id, child_id: job.child_id, error: errMsg });

      // 020 §3-12 — 전송 계층 오류 판정을 공통 모듈로 옮겼다.
      // 기존 `errMsg.includes("50")` 은 "50" 이 들어간 아무 메시지나 재시도 대상으로
      // 만들어(예: "50 messages processed") 영구 실패를 무한히 재큐잉하는 통로였다.
      const isRetryable = isRetryableTransportError(errMsg);

      const { error: failErr } = await db.rpc("fail_memory_batch_job_v3", {
        p_job_id: job.id,
        p_claimed_by: wId,
        p_error_code: isRetryable ? "RETRYABLE_ERROR" : "PERMANENT_ERROR",
        p_error_summary: errMsg.substring(0, 200),
        p_retryable: isRetryable,
      });

      if (failErr) {
        console.error(`Failed to mark memory job failed: ${failErr.message}`);
      }
    }
  }

  return summary;
}
