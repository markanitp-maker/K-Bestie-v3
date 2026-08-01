import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const executionId = req.nextUrl.searchParams.get("execution_id");
  if (!executionId) {
    return NextResponse.json({ error: "Missing execution_id" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: jobs, error } = await db
    .from("pipeline_jobs")
    .select("child_id, job_type, status, error_code")
    .eq("execution_id", executionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const statusByChild = new Map<string, any>();
  for (const job of jobs || []) {
    if (!statusByChild.has(job.child_id)) {
      statusByChild.set(job.child_id, { childId: job.child_id });
    }
    const state = statusByChild.get(job.child_id);
    
    // Convert status to Korean UI strings
    let uiStatus = "대기";
    if (job.status === "processing") uiStatus = "처리 중";
    if (job.status === "completed") uiStatus = "완료";
    if (job.status === "failed") uiStatus = "실패";
    if (job.status === "retry_wait") uiStatus = "재시도 대기";

    if (job.job_type === "collection_2" || job.job_type === "collection_1") {
      state.collection = uiStatus;
      if (job.error_code) state.collectionError = job.error_code;
    } else if (job.job_type === "context_correction") {
      state.correction = uiStatus;
      if (job.error_code) state.correctionError = job.error_code;
    } else if (job.job_type === "daily_report") {
      state.report = uiStatus;
      if (job.error_code) state.reportError = job.error_code;
    }
  }

  return NextResponse.json({
    ok: true,
    statuses: Array.from(statusByChild.values())
  });
}
