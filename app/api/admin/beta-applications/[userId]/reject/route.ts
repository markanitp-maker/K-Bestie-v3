import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { userId } = await params;
  const supabase = await createClient();
  const { data: { user: adminUser } } = await supabase.auth.getUser();

  if (!adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

  const service = createServiceClient();
  const { data, error } = await service.rpc("admin_reject_beta_application", {
    p_admin_user_id: adminUser.id,
    p_admin_email: adminUser.email!,
    p_target_user_id: userId,
    p_reason: reason,
  });

  if (error) {
    console.error("[Reject Beta Application Error]", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  if (!data || !data[0].success) {
    return NextResponse.json({ error: data?.[0]?.reason }, { status: 400 });
  }

  return NextResponse.json({ success: true, message: "베타 신청이 거절되었습니다." });
}
