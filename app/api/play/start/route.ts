import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { child_id?: string; play_type?: string; reservation_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { child_id, play_type, reservation_id } = body;
  if (!child_id || !play_type || !reservation_id) {
    return NextResponse.json({ error: "child_id, play_type, and reservation_id required" }, { status: 400 });
  }

  const service = createServiceClient();
  const authCheck = await requireChildAccess(service, user.id, child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1. 예약 성공시 start_new_play_session 호출
  const { data: startData, error: startErr } = await service.rpc("start_new_play_session", {
    p_child_id: child_id,
    p_play_type: play_type,
    p_new_reservation_id: reservation_id,
  });

  if (startErr || !startData || startData.length === 0) {
    console.error("[play/start] Start RPC error:", startErr);
    // 실패시 롤백
    await service.rpc("restore_gold_key_reservation", { p_reservation_id: reservation_id });
    return NextResponse.json({ error: "Start session failed, reservation restored" }, { status: 500 });
  }

  const startResult = startData[0] as { session_id: string | null; reason: string };

  if (!startResult.session_id) {
    // 실패시 롤백
    await service.rpc("restore_gold_key_reservation", { p_reservation_id: reservation_id });
    return NextResponse.json({ error: startResult.reason || "start_failed" }, { status: 400 });
  }

  return NextResponse.json({
    session_id: startResult.session_id,
    reason: "ok",
  });
}
