import { NextResponse } from "next/server";
import { processDailyReportJobsV3 } from "@/lib/batch/dailyReportV3";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const configuredSecrets = [process.env.BATCH_SECRET, process.env.CRON_SECRET].filter(
      (s): s is string => typeof s === "string" && s.trim().length > 0
    );
    const authHeader = req.headers.get("authorization") ?? "";
    if (
      configuredSecrets.length === 0 ||
      !configuredSecrets.some((secret) => authHeader === `Bearer ${secret}`)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let limit = 10;
    let executionId: string | undefined = undefined;
    try {
      const body = await req.json();
      if (body.limit !== undefined) {
        if (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 50) {
          return NextResponse.json({ error: "Invalid limit. Must be an integer between 1 and 50." }, { status: 400 });
        }
        limit = body.limit;
      }
      if (body.executionId !== undefined) {
        if (typeof body.executionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.executionId)) {
          return NextResponse.json({ error: "Invalid executionId. Must be a valid UUID string." }, { status: 400 });
        }
        executionId = body.executionId;
      }
    } catch {
      // Use default limit
    }

    const workerId = `worker_daily_report_${randomUUID()}`;
    let totalCompleted = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    const allErrors: any[] = [];
    const maxIterations = 20;

    for (let i = 0; i < maxIterations; i++) {
      const res = await processDailyReportJobsV3(limit, workerId, executionId, "scheduled");
      totalCompleted += res.completed;
      totalSkipped += res.skipped;
      totalFailed += res.failed;
      if (res.errors?.length) allErrors.push(...res.errors);
      if (res.completed === 0 && res.skipped === 0 && res.failed === 0) break;
    }

    return NextResponse.json({
      success: true,
      workerId,
      result: {
        completed: totalCompleted,
        skipped: totalSkipped,
        failed: totalFailed,
        errors: allErrors,
      },
    });
  } catch (error: any) {
    console.error("[v3/daily-report/worker] Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
