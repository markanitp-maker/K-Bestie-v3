import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase.rpc("mark_notification_read_v1", { p_notification_id: id });
  if (error) {
    const missing = error.message.includes("NOTIFICATION_NOT_FOUND");
    return NextResponse.json({ error: missing ? "Not found" : "Read update failed" }, { status: missing ? 404 : 500 });
  }
  const result = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, unreadCount: Number(result?.unread_count ?? 0), readAt: result?.read_at ?? null });
}

