import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { child_id, play_type, idempotency_key } = body;

    if (!child_id || !play_type || !idempotency_key) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { allowed } = await requireChildAccess(supabase, user.id, child_id);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const approvalBlocked = await checkApprovalForChild(child_id);
    if (approvalBlocked) return approvalBlocked;

    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient.rpc("consume_play_access", {
      p_child_id: child_id,
      p_play_type: play_type,
      p_idempotency_key: idempotency_key,
    });

    if (error) {
      console.error("[consume_play_access] RPC error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result || !result.session_id) {
      const reason = result?.reason || "unknown";
      
      const knownReasons = ["ok", "already_in_progress", "insufficient_balance", "invalid_input", "already_processed"];
      if (!knownReasons.includes(reason)) {
        console.error("[consume_play_access] RPC returned unexpected reason (possible SQLERRM):", reason);
        return NextResponse.json({ error: "server_error", reason: "server_error" }, { status: 500 });
      }

      const status = reason === "insufficient_balance" ? 402 : 400;
      return NextResponse.json({ error: reason, reason }, { status });
    }

    const start_mode = result.access_type === "resume" ? "resume" : "new";
    
    return NextResponse.json({
      session_id: result.session_id,
      access_type: result.access_type,
      golden_key_charged: result.golden_key_charged,
      remaining_golden_keys: result.remaining_golden_keys,
      start_mode,
      expires_at: result.resume_expires_at,
    });
  } catch (err) {
    console.error("[consume_play_access] route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
