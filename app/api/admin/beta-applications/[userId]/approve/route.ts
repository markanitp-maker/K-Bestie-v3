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

  let body: { tier?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const tier = body.tier;
  if (typeof tier !== "number" || ![1, 2, 3].includes(tier)) {
    return NextResponse.json({ error: "플랜(tier)을 1(Care Start)/2(Care Insight)/3(Care Premium) 중 하나로 지정해야 합니다." }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("admin_approve_beta_application", {
    p_admin_user_id: adminUser.id,
    p_admin_email: adminUser.email!,
    p_target_user_id: userId,
    p_tier: tier,
  });

  if (error) {
    console.error("[Approve Beta Application Error]", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  if (!data || !data[0].success) {
    return NextResponse.json({ error: data?.[0]?.reason }, { status: 400 });
  }

  return NextResponse.json({ success: true, message: "베타 신청이 승인되었습니다." });
}
