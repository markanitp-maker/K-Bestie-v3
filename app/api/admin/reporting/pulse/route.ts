import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { processCollectionJobsV3 } from "@/lib/batch/collection";
import { runContextCorrectionWorkerV3 } from "@/lib/batch/contextCorrectionV3";
import { runMemoryBatchWorkerV3 } from "@/lib/batch/memoryV3";
import { processDailyReportJobsV3 } from "@/lib/batch/dailyReportV3";
import { aggregateExecutionStatus } from "@/lib/admin/aggregateExecutionStatus";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || !body.executionId) {
    return NextResponse.json({ error: "Missing executionId" }, { status: 400 });
  }

  const { executionId, action } = body;
  const workerId = `admin_pulse_${executionId.substring(0, 8)}_${Date.now()}`;

  const db = createServiceClient();

  // Bounded worker step execution with independent try/catches & executionId parameter
  if (action === "collect" || action === "collect_and_generate") {
    try {
      await processCollectionJobsV3(2, 10, workerId, executionId);
    } catch (e) {
      console.error("[Pulse Collect Error]", e);
    }
  }

  if (action === "collect_and_generate") {
    try {
      await runContextCorrectionWorkerV3(10, workerId, executionId);
    } catch (e) {
      console.error("[Pulse Correction Error]", e);
    }
  }

  if (action === "generate" || action === "collect_and_generate") {
    try {
      await runMemoryBatchWorkerV3(10, workerId, executionId);
    } catch (e) {
      console.error("[Pulse Memory Error]", e);
    }

    try {
      await processDailyReportJobsV3(10, workerId, executionId);
    } catch (e) {
      console.error("[Pulse Report Error]", e);
    }
  }

  try {
    const aggregated = await aggregateExecutionStatus(db, executionId, action);

    return NextResponse.json({
      ok: true,
      isComplete: aggregated.isComplete,
      partialFailure: aggregated.partialFailure,
      summary: aggregated.summary,
      statuses: aggregated.statuses,
    });
  } catch (error: any) {
    console.error("[Pulse Aggregation Error]", error);
    return NextResponse.json({ error: error.message || "Failed to aggregate execution status" }, { status: 500 });
  }
}
