import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const adminRes = await requireAdmin();
    if (adminRes) return adminRes;

    const supabase = await createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { play_session_id, bug_report_id } = body;

    if (!play_session_id) {
      return NextResponse.json({ error: "Missing play_session_id" }, { status: 400 });
    }

    const serviceClient = createServiceClient();

    if (bug_report_id) {
      const { data: bugReport } = await serviceClient
        .from("play_bug_reports")
        .select("play_session_id")
        .eq("id", bug_report_id)
        .maybeSingle();
      if (!bugReport) {
        return NextResponse.json({ error: "Bug report not found" }, { status: 404 });
      }
      if (bugReport.play_session_id !== play_session_id) {
        return NextResponse.json({ error: "Bug report session mismatch" }, { status: 400 });
      }
    }

    const { data: rpcData, error: rpcErr } = await serviceClient.rpc("refund_play_session", {
      p_play_session_id: play_session_id,
    });

    if (rpcErr) {
      console.error("[admin/plays/refund] RPC error:", rpcErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;

    if (!result || !result.success) {
      const reason = result?.reason || "unknown";
      if (reason === "already_refunded") {
        return NextResponse.json({ error: "already_refunded" }, { status: 409 });
      }
      return NextResponse.json({ error: reason }, { status: 400 });
    }

    const refundedQuantity = result.refunded_count;
    const headerId = result.header_id;

    if (refundedQuantity > 0) {
      // Find the child_id from session
      const { data: session } = await serviceClient
        .from("k_play_sessions")
        .select("child_id")
        .eq("id", play_session_id)
        .maybeSingle();

      const failedSteps: string[] = [];

      if (session) {
        const { error: notifErr } = await serviceClient.from("play_refund_notifications").insert({
          child_id: session.child_id,
          play_session_id,
          refunded_quantity: refundedQuantity,
          reason: "manual_refund",
        });
        if (notifErr) failedSteps.push("notification");
      } else {
        failedSteps.push("notification");
      }

      const { error: updateErr } = await serviceClient
        .from("k_play_sessions")
        .update({ status: "refunded" })
        .eq("id", play_session_id)
        .neq("status", "refunded");
      
      if (updateErr) failedSteps.push("session_update");

      if (bug_report_id) {
        const { error: bugErr } = await serviceClient
          .from("play_bug_reports")
          .update({
            manual_refund_done: true,
            manual_refund_quantity: refundedQuantity,
            manual_refund_by: user.id,
            manual_refund_ledger_ref: headerId,
            status: "resolved", // Or keep as is, but let's assume refunding resolves it or it's handled separately
            resolved_at: new Date().toISOString()
          })
          .eq("id", bug_report_id);
        
        if (bugErr) failedSteps.push("bug_report_update");
      }

      if (failedSteps.length > 0) {
        return NextResponse.json({ 
          ok: true, 
          refunded_quantity: refundedQuantity, 
          partialFailure: true, 
          failedSteps,
          followUpError: `Failed to update: ${failedSteps.join(", ")}`
        });
      }
    }

    return NextResponse.json({ ok: true, refunded_quantity: refundedQuantity });
  } catch (err) {
    console.error("[admin/plays/refund] route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
