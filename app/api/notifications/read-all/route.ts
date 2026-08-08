import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase.rpc("mark_all_notifications_read_v1");
  if (error) return NextResponse.json({ error: "Read update failed" }, { status: 500 });
  return NextResponse.json({ ok: true, unreadCount: Number(data ?? 0) });
}

