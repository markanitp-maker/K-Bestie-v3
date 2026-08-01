import { NextResponse } from "next/server";
import { runV3RetentionPurge, isValidDateString, subtractDays } from "@/lib/batch/retentionV3";
import { getKstNow } from "@/lib/batch/cleanupV3";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

// POST /api/batch/v3/retention/worker
// Bounded worker invocation for 7-day V3 raw and corrected retention purge
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET || process.env.BATCH_SECRET;

    // Fail closed in every environment: missing secret OR mismatched header
    if (!secret || secret.trim() === "") {
      return NextResponse.json({ error: "Batch secret environment variable not set" }, { status: 500 });
    }

    if (!authHeader || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let limit = 1000;
    let referenceDate: string | undefined;
    let cutoffDate: string | undefined;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Body is optional
    }

    if (body.limit !== undefined) {
      if (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 5000) {
        return NextResponse.json({ error: "Invalid limit: must be an integer between 1 and 5000" }, { status: 400 });
      }
      limit = body.limit;
    }

    const kst = getKstNow();

    if (body.referenceDate !== undefined) {
      if (!isValidDateString(body.referenceDate)) {
        return NextResponse.json({ error: "Invalid referenceDate: must be a valid YYYY-MM-DD date string" }, { status: 400 });
      }
      if (body.referenceDate > kst.dateStr) {
        return NextResponse.json({ error: `Invalid referenceDate: referenceDate (${body.referenceDate}) cannot be in the future relative to current KST date (${kst.dateStr})` }, { status: 400 });
      }
      referenceDate = body.referenceDate;
    }

    const effectiveReferenceDate = referenceDate || kst.dateStr;
    const expectedCutoff = subtractDays(effectiveReferenceDate, 7);

    if (body.cutoffDate !== undefined) {
      if (!isValidDateString(body.cutoffDate)) {
        return NextResponse.json({ error: "Invalid cutoffDate: must be a valid YYYY-MM-DD date string" }, { status: 400 });
      }
      if (body.cutoffDate !== expectedCutoff) {
        return NextResponse.json({
          error: `Invalid cutoffDate: supplied cutoffDate (${body.cutoffDate}) does not match exact 7-day retention cutoff (${expectedCutoff})`
        }, { status: 400 });
      }
      cutoffDate = body.cutoffDate;
    }

    const workerId = `worker_retention_${randomUUID()}`;
    const result = await runV3RetentionPurge({ referenceDate, cutoffDate, limit });

    return NextResponse.json({
      success: true,
      workerId,
      result,
    });
  } catch (error: any) {
    console.error("[v3/retention/worker] Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
