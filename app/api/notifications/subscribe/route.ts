import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "endpoint, keys.p256dh, keys.auth required" }, { status: 400 });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: user.id, endpoint, p256dh, auth, updated_at: new Date().toISOString() },
    { onConflict: "user_id,endpoint" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", body.endpoint);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
