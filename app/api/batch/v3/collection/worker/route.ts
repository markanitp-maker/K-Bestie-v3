import { NextResponse } from "next/server";
import { processCollectionJobsV3 } from "@/lib/batch/collection";
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

    const body = await req.json().catch(() => ({}));
    const { phase, limit = 10, executionId } = body;

    if (phase !== 1 && phase !== 2) {
      return NextResponse.json({ error: "Invalid phase, must be 1 or 2" }, { status: 400 });
    }

    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return NextResponse.json({ error: "Invalid limit, must be an integer between 1 and 100" }, { status: 400 });
    }

    if (executionId !== undefined && (typeof executionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(executionId))) {
      return NextResponse.json({ error: "Invalid executionId, must be a valid UUID string" }, { status: 400 });
    }

    const workerId = `worker_col_${randomUUID()}`;
    let totalClaimed = 0;
    let totalCompleted = 0;
    const allErrors: any[] = [];
    const maxIterations = 20;

    for (let i = 0; i < maxIterations; i++) {
      const res = await processCollectionJobsV3(phase, limit, workerId, executionId);
      totalClaimed += res.claimed;
      totalCompleted += res.completed;
      if (res.errors?.length) allErrors.push(...res.errors);
      if (res.claimed === 0) break;
    }

    return NextResponse.json({
      success: true,
      phase,
      workerId,
      result: {
        claimed: totalClaimed,
        completed: totalCompleted,
        errors: allErrors,
      },
    });
  } catch (error: any) {
    console.error("[v3/collection/worker] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
