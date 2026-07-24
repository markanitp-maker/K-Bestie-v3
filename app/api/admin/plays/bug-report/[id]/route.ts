import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminRes = await requireAdmin();
    if (adminRes) return adminRes;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const body = await req.json();
    const { status, admin_note } = body;

    const updates: any = { updated_at: new Date().toISOString() };
    if (status !== undefined) updates.status = status;
    if (admin_note !== undefined) updates.admin_note = admin_note;
    
    if (status === "resolved") {
      updates.resolved_at = new Date().toISOString();
    }

    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient
      .from("play_bug_reports")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[admin/plays/bug-report] Update error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[admin/plays/bug-report] route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
