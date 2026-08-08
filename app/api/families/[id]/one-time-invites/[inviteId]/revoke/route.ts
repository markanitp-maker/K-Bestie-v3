import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const { id: familyId, inviteId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const service = createServiceClient();
  const { data: member } = await service
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (member?.role !== "owner_parent") {
    return NextResponse.json({ error: "가족 오너만 초대를 취소할 수 있습니다." }, { status: 403 });
  }

  const { data, error } = await service
    .from("family_join_requests")
    .update({ status: "cancelled", revoked_at: new Date().toISOString(), reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("family_id", familyId)
    .eq("invite_kind", "one_time_link")
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "취소할 수 있는 초대가 없습니다." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
