import { createServiceClient } from "@/lib/supabase/server";
import { getSupabaseUrl } from "@/lib/supabase/env";

export type MemoryExecutionResult = {
  status: "completed" | "skipped" | "failed";
  childId: string;
  businessDate: string;
  error?: string;
};

export async function executeMemoryBatchForChildDate(
  childId: string,
  businessDate: string
): Promise<MemoryExecutionResult> {
  const baseUrl = getSupabaseUrl();
  const secret = process.env.BATCH_SECRET || process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    throw new Error(
      "MEMORY_CONFIG_MISSING: Missing SUPABASE_URL or secret (BATCH_SECRET / CRON_SECRET)"
    );
  }

  const endpointUrl = `${baseUrl.replace(/\/$/, "")}/functions/v1/memory-batch`;

  const res = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ date: businessDate, childId }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errorText.substring(0, 200)}`);
  }

  const data = await res.json().catch(() => null);
  if (!data || data.ok !== true || !data.result) {
    throw new Error(data?.error || "Memory batch returned invalid response");
  }

  const result = data.result;

  // Inspect payload-level errors
  const childErr = (result.errors || []).find((e: any) => e.childId === childId);
  if (childErr) {
    throw new Error(`Memory summary failed for child: ${childErr.error}`);
  }

  const factErrors = result.memoryFacts?.errors || [];
  const factChildErr = factErrors.find((e: any) => e.childId === childId);
  if (factChildErr) {
    throw new Error(`Memory facts failed for child: ${factChildErr.error}`);
  }

  if (result.memoryFacts?.error && typeof result.memoryFacts.error === "string") {
    throw new Error(`Memory facts error: ${result.memoryFacts.error}`);
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

  for (const job of jobs) {
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

      const isRetryable =
        errMsg.includes("429") ||
        errMsg.includes("50") ||
        errMsg.includes("fetch failed") ||
        errMsg.includes("timeout");

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
