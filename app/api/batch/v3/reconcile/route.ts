import { NextResponse } from "next/server";
import { reconcilePipelineV3, previousKstBusinessDate } from "@/lib/batch/reconcileV3";
import { isValidDateString } from "@/lib/batch/collection";
import { getOffsetDateStr, toKSTDateStr } from "@/lib/analytics/kstDate";

export const runtime = "nodejs";

function authorized(req: Request): boolean {
  const configured = [process.env.BATCH_SECRET, process.env.CRON_SECRET]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const header = req.headers.get("authorization") ?? "";
  return configured.length > 0 && configured.some((secret) => header === `Bearer ${secret}`);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ success: true, ...(await reconcilePipelineV3(previousKstBusinessDate())) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reconciliation failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const targetDate = body.targetDate;
    const today = toKSTDateStr(new Date().toISOString());
    if (!isValidDateString(targetDate) || targetDate < getOffsetDateStr(today, -6) || targetDate > today) {
      return NextResponse.json({ error: "targetDate must be within the latest 7 KST dates" }, { status: 400 });
    }
    return NextResponse.json({ success: true, ...(await reconcilePipelineV3(targetDate)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reconciliation failed" }, { status: 500 });
  }
}
