import { NextRequest, NextResponse } from "next/server";
import { runCollectionPipeline, isValidDateString } from "@/lib/batch/collection";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const configuredSecrets = [process.env.BATCH_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );
  const authHeader = req.headers.get("authorization") ?? "";

  // Fail closed: missing secret OR mismatched auth header
  if (
    configuredSecrets.length === 0 ||
    !configuredSecrets.some((secret) => authHeader === `Bearer ${secret}`)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { date?: string; isSecondRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* fallback to default */
  }

  const targetDate =
    body.date ??
    (() => {
      const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      return kst.toISOString().slice(0, 10);
    })();

  if (!isValidDateString(targetDate)) {
    return NextResponse.json({ error: "date must be a valid YYYY-MM-DD date string" }, { status: 400 });
  }

  let isSecondRun = body.isSecondRun;
  if (isSecondRun !== undefined && typeof isSecondRun !== "boolean") {
    return NextResponse.json({ error: "isSecondRun must be a boolean" }, { status: 400 });
  }

  if (isSecondRun === undefined) {
    const kstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();
    isSecondRun = kstHour >= 20; 
  }

  try {
    const result = await runCollectionPipeline(targetDate, isSecondRun);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    console.error("[batch/collection] error:", e);
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
