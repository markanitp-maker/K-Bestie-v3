import { NextResponse } from "next/server";
import { enqueueCollectionJobsV3, isValidDateString } from "@/lib/batch/collection";
import { getKstBusinessDate } from "@/lib/utils/kstBusinessDate";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

// Production daily_single uses one end-of-day collection. The database keeps
// collection phase 2 as a backward-compatible storage/job key so historical
// phase 1/2 rows and report snapshots remain untouched.
const DAILY_COLLECTION_PHASE = 2 as const;

// POST /api/batch/v3/collection/enqueue
// Triggers the creation of collection jobs for Phase 1 or 2
export async function POST(req: Request) {
  try {
    const configuredSecrets = [process.env.BATCH_SECRET, process.env.CRON_SECRET].filter(
      (s): s is string => typeof s === "string" && s.trim().length > 0
    );
    const authHeader = req.headers.get("authorization") ?? "";

    // Fail closed: missing secret OR mismatched header
    if (
      configuredSecrets.length === 0 ||
      !configuredSecrets.some((secret) => authHeader === `Bearer ${secret}`)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { phase, targetDate } = body;

    if (phase !== 1 && phase !== 2) {
      return NextResponse.json({ error: "Invalid phase, must be 1 or 2" }, { status: 400 });
    }

    if (!targetDate || !isValidDateString(targetDate)) {
      return NextResponse.json({ error: "Missing or invalid targetDate (must be real YYYY-MM-DD)" }, { status: 400 });
    }

    const executionId = randomUUID();
    
    const result = await enqueueCollectionJobsV3(targetDate, phase, executionId);

    return NextResponse.json({
      success: true,
      phase,
      targetDate,
      executionId,
      result
    });
  } catch (error: any) {
    console.error("[v3/collection/enqueue] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/batch/v3/collection/enqueue
// Canonical Vercel Cron entry: one daily_single end-of-day collection.
// An explicit phase remains available only for historical/manual compatibility.
export async function GET(req: Request) {
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

    const { searchParams } = new URL(req.url);
    const phaseStr = searchParams.get("phase");
    const phase = phaseStr === null ? DAILY_COLLECTION_PHASE : parseInt(phaseStr, 10);

    if (phase !== 1 && phase !== 2) {
      return NextResponse.json({ error: "Invalid phase, must be 1 or 2" }, { status: 400 });
    }

    const targetDate = getKstBusinessDate();
    const executionId = randomUUID();
    
    const result = await enqueueCollectionJobsV3(targetDate, phase, executionId);

    return NextResponse.json({
      success: true,
      collectionMode: phaseStr === null ? "daily_single" : "legacy_phase",
      phase,
      targetDate,
      executionId,
      result
    });
  } catch (error: any) {
    console.error("[v3/collection/enqueue (GET)] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
