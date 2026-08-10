import { NextRequest, NextResponse } from "next/server";
import { resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import {
  fetchAllAnalyticsRows,
  loadAnalyticsIdentity,
  roundAverage,
  roundRate,
  settledValue,
} from "@/lib/admin/analyticsPhase2";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface PipelineJobRow {
  id: string;
  child_id: string;
  business_date: string;
  job_type: string;
  status: string;
  attempt_count: number;
  started_at: string | null;
  completed_at: string | null;
  last_error_code: string | null;
  updated_at: string;
}

const STAGES = [
  { key: "collection_1", label: "1차 수집" },
  { key: "collection_2", label: "2차 수집" },
  { key: "context_correction", label: "Context Correction" },
  { key: "memory_batch", label: "Memory Batch" },
  { key: "daily_report", label: "Daily Report" },
] as const;

interface PipelineStageResult {
  key: string;
  label: string;
  target: number | null;
  success: number | null;
  failure: number | null;
  pending: number | null;
  successRate: number | null;
  averageProcessingSeconds: number | null;
  retries: number | null;
  errorCodes: Array<{ code: string; count: number }>;
  status: "ready" | "unavailable";
  reason?: string;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let filters;
  try {
    filters = resolveAnalyticsKstFilters(req.nextUrl.searchParams);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "잘못된 조회 기간입니다." }, { status: 400 });
  }
  const service = createServiceClient();
  try {
    const settled = await Promise.allSettled([
      loadAnalyticsIdentity(service, filters.internalTest, filters.channel),
      fetchAllAnalyticsRows<PipelineJobRow>((from, to) => service.from("pipeline_jobs")
        .select("id,child_id,business_date,job_type,status,attempt_count,started_at,completed_at,last_error_code,updated_at")
        .gte("business_date", filters.from).lte("business_date", filters.to)
        .order("updated_at").range(from, to)),
    ]);
    const identity = settledValue(settled[0], "분석 대상");
    const jobs = settledValue(settled[1], "Pipeline 작업").filter((row) => identity.childIds.has(row.child_id));
    const stages: PipelineStageResult[] = STAGES.map((stage) => {
      const rows = jobs.filter((row) => row.job_type === stage.key);
      const success = rows.filter((row) => row.status === "completed").length;
      const failure = rows.filter((row) => row.status === "failed").length;
      const pending = rows.length - success - failure;
      const durations = rows.filter((row) => row.started_at && row.completed_at)
        .map((row) => (Date.parse(row.completed_at as string) - Date.parse(row.started_at as string)) / 1000)
        .filter((value) => value >= 0);
      const errorCodes = new Map<string, number>();
      for (const row of rows) {
        if (!row.last_error_code) continue;
        errorCodes.set(row.last_error_code, (errorCodes.get(row.last_error_code) ?? 0) + 1);
      }
      return {
        key: stage.key,
        label: stage.label,
        target: rows.length,
        success,
        failure,
        pending,
        successRate: roundRate(success, rows.length),
        averageProcessingSeconds: roundAverage(durations),
        retries: rows.reduce((sum, row) => sum + Math.max(0, Number(row.attempt_count) - 1), 0),
        errorCodes: [...errorCodes.entries()].map(([code, count]) => ({ code, count })).sort((left, right) => right.count - left.count),
        status: "ready",
      };
    });
    stages.push({
      key: "weekly_report",
      label: "Weekly Report",
      target: null,
      success: null,
      failure: null,
      pending: null,
      successRate: null,
      averageProcessingSeconds: null,
      retries: null,
      errorCodes: [],
      status: "unavailable",
      reason: "현재 pipeline_jobs.job_type에 weekly_report 단계가 없어 값을 추정하지 않습니다.",
    });

    return NextResponse.json({ filters, stages, meta: { source: "pipeline_jobs", generatedAt: new Date().toISOString() } });
  } catch (error) {
    console.error("[admin/analytics/pipeline] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pipeline 집계에 실패했습니다." }, { status: 500 });
  }
}
