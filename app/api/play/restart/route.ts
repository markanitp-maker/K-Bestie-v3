import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

function getKeysNeeded(playType: string) {
  if (playType === "comic_book" || playType === "quiz") return 2;
  if (playType === "hairstyle" || playType === "mbti") return 3;
  return 3; // fallback
}

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { child_id?: string; play_type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { child_id, play_type } = body;
  if (!child_id || !play_type) {
    return NextResponse.json({ error: "child_id and play_type required" }, { status: 400 });
  }

  const service = createServiceClient();
  const authCheck = await requireChildAccess(service, user.id, child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const keys_needed = getKeysNeeded(play_type);

  // 1. 재시작 모드로 예약 RPC 호출 (p_is_restart = true)
  const { data: rpcData, error: rpcErr } = await service.rpc("reserve_gold_keys_for_play", {
    p_child_id: child_id,
    p_play_type: play_type,
    p_keys_needed: keys_needed,
    p_is_restart: true,
  });

  if (rpcErr || !rpcData || rpcData.length === 0) {
    console.error("[play/restart] Reserve RPC error:", rpcErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const result = rpcData[0] as { reservation_id: string | null; reason: string };

  if (!result.reservation_id) {
    return NextResponse.json({ error: result.reason || "reserve_failed" }, { status: 400 });
  }

  // 2. 예약 성공시 start_new_play_session 호출
  const { data: startData, error: startErr } = await service.rpc("start_new_play_session", {
    p_child_id: child_id,
    p_play_type: play_type,
    p_new_reservation_id: result.reservation_id,
  });

  if (startErr || !startData || startData.length === 0) {
    console.error("[play/restart] Start RPC error:", startErr);
    // 실패시 롤백
    await service.rpc("restore_gold_key_reservation", { p_reservation_id: result.reservation_id });
    return NextResponse.json({ error: "Start session failed, reservation restored" }, { status: 500 });
  }

  const startResult = startData[0] as { session_id: string | null; reason: string };

  if (!startResult.session_id) {
    // 실패시 롤백
    await service.rpc("restore_gold_key_reservation", { p_reservation_id: result.reservation_id });
    return NextResponse.json({ error: startResult.reason || "start_failed" }, { status: 400 });
  }

  return NextResponse.json({
    session_id: startResult.session_id,
    reason: "ok",
  });
}
