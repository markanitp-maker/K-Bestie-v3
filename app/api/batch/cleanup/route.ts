import { NextRequest, NextResponse } from "next/server";
import { runOriginalChatMessageCleanup } from "@/lib/batch/cleanupV3";

export const runtime = "nodejs";
export const maxDuration = 300;

function isValidIsoDateTimeString(isoStr: string): boolean {
  if (typeof isoStr !== "string" || !isoStr.trim()) return false;
  const timestamp = Date.parse(isoStr);
  return !isNaN(timestamp);
}

export async function POST(req: NextRequest) {
  const secret = process.env.BATCH_SECRET || process.env.CRON_SECRET;
  if (!secret || secret.trim() === "") {
    return NextResponse.json({ error: "Batch secret environment variable not set" }, { status: 500 });
  }

  const auth = req.headers.get("authorization");
  if (!auth || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let limit = 1000;
    let cutoffAt: string | undefined;
    let force = false;

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

    if (body.cutoffAt !== undefined) {
      if (!isValidIsoDateTimeString(body.cutoffAt)) {
        return NextResponse.json({ error: "Invalid cutoffAt: must be a valid ISO date-time string" }, { status: 400 });
      }
      if (Date.parse(body.cutoffAt) > Date.now()) {
        return NextResponse.json({ error: "Invalid cutoffAt: cutoffAt cannot be in the future relative to server time" }, { status: 400 });
      }
      cutoffAt = body.cutoffAt;
    }

    if (body.force !== undefined) {
      if (typeof body.force !== "boolean") {
        return NextResponse.json({ error: "Invalid force: must be a boolean" }, { status: 400 });
      }
      if (body.force && process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Force flag is not permitted in production" }, { status: 400 });
      }
      force = body.force;
    }

    const result = await runOriginalChatMessageCleanup({ limit, cutoffAt, force });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[batch/cleanup] Failed:", e);
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
