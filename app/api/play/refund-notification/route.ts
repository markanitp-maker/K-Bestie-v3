import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const child_id = searchParams.get("child_id");

    if (!child_id) {
      return NextResponse.json({ error: "Missing child_id parameter" }, { status: 400 });
    }

    const { allowed } = await requireChildAccess(supabase, user.id, child_id);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const serviceClient = createServiceClient();
    
    // 1건 조회 (가장 오래된 것부터 보여준다고 가정)
    const { data: notification, error: notifErr } = await serviceClient
      .from("play_refund_notifications")
      .select("id")
      .eq("child_id", child_id)
      .is("shown_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (notifErr) {
      console.error("[refund-notification] DB error:", notifErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!notification) {
      return NextResponse.json({ notification: null });
    }

    // 마킹을 조건부 업데이트로 원자적으로 수행 (동시 GET 중복 노출 방지)
    const { data: updated, error: updateErr } = await serviceClient
      .from("play_refund_notifications")
      .update({ shown_at: new Date().toISOString() })
      .eq("id", notification.id)
      .is("shown_at", null)
      .select("refunded_quantity, reason")
      .maybeSingle();
      
    if (updateErr) {
      console.error("[refund-notification] Update error:", updateErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    
    if (!updated) {
      // 다른 요청이 먼저 claim 함
      return NextResponse.json({ notification: null });
    }

    return NextResponse.json({ 
      notification: {
        refunded_quantity: updated.refunded_quantity,
        reason: updated.reason
      } 
    });
  } catch (err) {
    console.error("[refund-notification] route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
