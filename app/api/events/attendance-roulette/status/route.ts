import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { getBalance } from "@/lib/goldkey/ledger";
import { kstDateKey } from "@/lib/events/attendanceRoulette";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) return NextResponse.json({ error: "childId required" }, { status: 400 });

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await requireChildAccess(auth, user.id, childId);
  if (!access.allowed || access.role !== "child") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const attendanceDate = kstDateKey();
  const service = createServiceClient();
  const [{ data: day, error: dayError }, { data: lastSpin, error: spinError }, balance] = await Promise.all([
    service
      .from("attendance_roulette_days")
      .select("base_spin_used, retry_credits_granted, retry_credits_used")
      .eq("child_id", childId)
      .eq("attendance_date", attendanceDate)
      .maybeSingle(),
    service
      .from("attendance_roulette_spins")
      .select("id, attendance_date, source, result_code, key_reward, settled_at")
      .eq("child_id", childId)
      .eq("attendance_date", attendanceDate)
      .order("spin_sequence", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getBalance(childId),
  ]);

  if (dayError || spinError) {
    console.error("[attendance-roulette/status] query failed", dayError?.code ?? spinError?.code);
    return NextResponse.json({ error: "status_unavailable" }, { status: 500 });
  }

  const baseSpinUsed = day?.base_spin_used ?? false;
  const retryCreditsRemaining = Math.max(0, (day?.retry_credits_granted ?? 0) - (day?.retry_credits_used ?? 0));
  const canSpin = !baseSpinUsed || retryCreditsRemaining > 0;

  return NextResponse.json({
    attendanceDate,
    canSpin,
    nextSource: !baseSpinUsed ? "BASE" : retryCreditsRemaining > 0 ? "RETRY" : null,
    baseSpinUsed,
    retryCreditsRemaining,
    lastSpin: lastSpin ? {
      spinId: lastSpin.id,
      attendanceDate: lastSpin.attendance_date,
      source: lastSpin.source,
      resultCode: lastSpin.result_code,
      keyReward: lastSpin.key_reward,
      settledAt: lastSpin.settled_at,
    } : null,
    balance,
  }, { headers: { "Cache-Control": "no-store" } });
}
