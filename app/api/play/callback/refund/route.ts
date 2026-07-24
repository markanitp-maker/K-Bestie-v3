import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { AUTO_REFUND_STAGES } from "@/lib/play/protocol";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { child_id, play_session_id, stage, error_code, error_message } = body;

    if (!child_id || !play_session_id || !stage) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { allowed } = await requireChildAccess(supabase, user.id, child_id);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const serviceClient = createServiceClient();

    // Verify session ownership and progress state
    const { data: session, error: sessionErr } = await serviceClient
      .from("k_play_sessions")
      .select("child_id, progress_state, status")
      .eq("id", play_session_id)
      .maybeSingle();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.child_id !== child_id) {
      return NextResponse.json({ error: "Session ownership mismatch" }, { status: 403 });
    }

    // [최적화 목적의 사전 검사]
    // 여기서 수행하는 status 및 progress 검사는 RPC 호출 전의 빠른 실패(fast-fail)를 위한 것입니다.
    // 이 조회 시점과 실제 RPC 실행 시점 사이에 상태가 변경될 수 있는 경쟁 조건이 이론적으로 존재할 수 있으나,
    // 이중 환불 방지 등을 위한 최종적이고 원자적인 검증은 아래 호출되는 'refund_play_session' RPC 내부에서 위임되어 안전하게 처리됩니다.
    if (session.status !== 'in_progress') {
      return NextResponse.json({ error: "Session is not in progress" }, { status: 400 });
    }

    if (!AUTO_REFUND_STAGES.has(stage)) {
      return NextResponse.json({ refunded: false, reason: "not_refundable_stage" });
    }

    const progress = session.progress_state;
    const hasProgress = progress && typeof progress === 'object' && Object.keys(progress).length > 0;
    
    if (hasProgress) {
      return NextResponse.json({ refunded: false, reason: "not_refundable_progressed" });
    }

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("refund_play_session", {
      p_play_session_id: play_session_id,
    });

    if (rpcErr) {
      console.error("[refund_gold_keys] RPC error:", rpcErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;

    if (!result || !result.success) {
      return NextResponse.json({ refunded: false, reason: result?.reason || "unknown" });
    }

    const refundedQuantity = result.refunded_count;

    if (refundedQuantity > 0) {
      const { error: notifErr } = await serviceClient.from("play_refund_notifications").insert({
        child_id,
        play_session_id,
        refunded_quantity: refundedQuantity,
        reason: error_code || "auto_refund",
      });
      if (notifErr) {
        console.error("[callback/refund] Failed to insert notification:", notifErr);
      }
      
      const { error: updateErr } = await serviceClient
        .from("k_play_sessions")
        .update({ status: "refunded" })
        .eq("id", play_session_id)
        .neq("status", "refunded");
      if (updateErr) {
        console.error("[callback/refund] Failed to update session status:", updateErr);
      }
    }

    return NextResponse.json({ refunded: true, refunded_quantity: refundedQuantity });
  } catch (err) {
    console.error("[callback/refund] route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
