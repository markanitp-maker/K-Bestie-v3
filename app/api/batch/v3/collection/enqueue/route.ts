import { NextResponse } from "next/server";
import { enqueueCollectionJobsV3, isValidDateString } from "@/lib/batch/collection";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

function getKSTDateString(): string {
  const kstOptions = { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" } as const;
  const parts = new Intl.DateTimeFormat("en-US", kstOptions).formatToParts(new Date());
  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

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
// Triggered by Vercel Cron (supports GET requests)
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
    const phase = parseInt(phaseStr ?? "", 10);

    if (phase !== 1 && phase !== 2) {
      return NextResponse.json({ error: "Invalid phase, must be 1 or 2" }, { status: 400 });
    }

    const targetDate = getKSTDateString();
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
    console.error("[v3/collection/enqueue (GET)] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
