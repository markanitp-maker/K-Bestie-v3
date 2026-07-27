import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getSupabaseTarget } from "@/lib/supabase/env";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (getSupabaseTarget() === "prod") {
    return NextResponse.json({ error: "Forbidden in prod" }, { status: 403 });
  }

  const businessDate = req.nextUrl.searchParams.get("businessDate");
  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return NextResponse.json({ error: "Invalid businessDate" }, { status: 400 });
  }

  const db = createServiceClient();

  const results = await Promise.allSettled([
    db.from("child_profiles").select("id"),
    db.from("raw_daily_conversations").select("child_id").eq("business_date", businessDate),
    db.from("daily_reports").select("child_id").eq("business_date", businessDate).is("deleted_at", null)
  ]);

  const childrenRes = results[0].status === "fulfilled" ? results[0].value : { error: new Error("Failed"), data: [] };
  const rawRes = results[1].status === "fulfilled" ? results[1].value : { error: null, data: [] };
  const reportRes = results[2].status === "fulfilled" ? results[2].value : { error: null, data: [] };

  if (childrenRes.error) return NextResponse.json({ error: childrenRes.error.message }, { status: 500 });

  const totalChildren = childrenRes.data.length;
  
  const rawChildIds = new Set((rawRes.data || []).map((r: any) => r.child_id));
  const hasValidConversation = rawChildIds.size;
  
  const reportChildIds = new Set((reportRes.data || []).map((r: any) => r.child_id));
  const reportExists = reportChildIds.size;
  
  let reportMissing = 0;
  for (const cid of rawChildIds) {
    if (!reportChildIds.has(cid)) reportMissing++;
  }

  return NextResponse.json({
    totalChildren,
    hasValidConversation,
    reportMissing,
    reportExists
  });
}
