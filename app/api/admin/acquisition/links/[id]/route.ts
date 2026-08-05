import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAdminActor } from "@/lib/admin/adminActor";
import { softDeleteRecords } from "@/lib/admin/softDeleteService";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { denied } = await requireAdminActor("admin_acquisition_links_patch");
  if (denied) return denied;

  const { id } = await params;
  const supabase = await createClient();
  
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowedUpdates = ["channel_name", "utm_source", "utm_medium", "utm_campaign", "utm_content", "purpose", "destination_path", "status", "memo", "starts_at", "ends_at"];
  const updateData: any = {};
  
  for (const key of allowedUpdates) {
    if (body[key] !== undefined) {
      updateData[key] = body[key];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  updateData.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from("acquisition_links").update(updateData).eq("id", id).select().single();

  if (error) {
    console.error("[admin/acquisition/links/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ link: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { denied, actor } = await requireAdminActor("admin_acquisition_links_delete");
  if (denied) return denied;

  const { id } = await params;
  const supabase = await createClient();

  try {
    await softDeleteRecords(
      supabase,
      "acquisition_links",
      [id],
      actor,
      "Admin deleted link"
    );
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[admin/acquisition/links/[id]] DELETE error:", error);
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
