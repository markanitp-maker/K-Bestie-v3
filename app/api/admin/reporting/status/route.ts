import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { aggregateExecutionStatus } from "@/lib/admin/aggregateExecutionStatus";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const executionId = req.nextUrl.searchParams.get("execution_id");
  const action = req.nextUrl.searchParams.get("action");

  if (!executionId) {
    return NextResponse.json({ error: "Missing execution_id" }, { status: 400 });
  }

  const db = createServiceClient();
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
    console.error("[ReportingStatus Error]", error);
    return NextResponse.json({ error: error.message || "Failed to query status" }, { status: 500 });
  }
}
