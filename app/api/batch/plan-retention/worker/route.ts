import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  DEFAULT_PLAN_RETENTION_BATCH_LIMIT,
  MAX_PLAN_RETENTION_BATCH_LIMIT,
  isValidPlanRetentionDate,
  runPlanRetentionCleanup,
} from "@/lib/batch/planRetentionCleanup";
import { getKstNow } from "@/lib/batch/cleanupV3";

export const runtime = "nodejs";
export const maxDuration = 300;

interface WorkerInput {
  limit?: unknown;
  referenceDate?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const authenticate = (req: Request): NextResponse | null => {
  const secret = process.env.CRON_SECRET || process.env.BATCH_SECRET;
  if (!secret?.trim()) {
    return NextResponse.json({ error: "Batch secret environment variable not set" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
};

const parseInput = async (req: Request): Promise<WorkerInput> => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const limit = url.searchParams.get("limit");
    return {
      limit: limit === null ? undefined : Number(limit),
      referenceDate: url.searchParams.get("referenceDate") ?? undefined,
    };
  }

  try {
    const body: unknown = await req.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
};

const handleWorker = async (req: Request): Promise<NextResponse> => {
  const denied = authenticate(req);
  if (denied) return denied;

  const input = await parseInput(req);
  const limit = input.limit ?? DEFAULT_PLAN_RETENTION_BATCH_LIMIT;
  const referenceDate = input.referenceDate;

  if (
    typeof limit !== "number"
    || !Number.isInteger(limit)
    || limit < 1
    || limit > MAX_PLAN_RETENTION_BATCH_LIMIT
  ) {
    return NextResponse.json(
      { error: `Invalid limit: must be an integer between 1 and ${MAX_PLAN_RETENTION_BATCH_LIMIT}` },
      { status: 400 }
    );
  }

  if (referenceDate !== undefined) {
    if (typeof referenceDate !== "string" || !isValidPlanRetentionDate(referenceDate)) {
      return NextResponse.json(
        { error: "Invalid referenceDate: must be a valid YYYY-MM-DD date string" },
        { status: 400 }
      );
    }
    if (referenceDate > getKstNow().dateStr) {
      return NextResponse.json({ error: "Invalid referenceDate: cannot be in the future" }, { status: 400 });
    }
  }

  const workerId = `worker_plan_retention_${randomUUID()}`;

  try {
    const result = await runPlanRetentionCleanup({ referenceDate, limit });
    console.info("[plan-retention/worker] completed", {
      workerId,
      success: result.success,
      totalDeleted: result.totalDeleted,
      dailyReportsDeleted: result.datasets.find((item) => item.dataset === "daily_reports")?.deletedCount ?? 0,
      weeklySummariesDeleted: result.datasets.find((item) => item.dataset === "weekly_summaries")?.deletedCount ?? 0,
      childMemoryDeleted: result.datasets.find((item) => item.dataset === "child_memory")?.deletedCount ?? 0,
      failedDatasetCount: result.failedDatasets.length,
      hasMore: result.hasMore,
    });

    return NextResponse.json(
      { success: result.success, workerId, result },
      { status: result.partialFailure ? 207 : 200 }
    );
  } catch (error: unknown) {
    console.error("[plan-retention/worker] failed", {
      workerId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Plan retention cleanup failed" }, { status: 500 });
  }
};

export const GET = handleWorker;
export const POST = handleWorker;
