import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { childId } = body;
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const authCheck = await requireChildAccess(authClient, user.id, childId);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const yyyy = kstNow.getUTCFullYear();
  const mm = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstNow.getUTCDate()).padStart(2, '0');
  const businessDate = `${yyyy}-${mm}-${dd}`;
  const conversationWindow = kstNow.getUTCHours() < 18 ? 'day' : 'evening';

  const service = createServiceClient();

  const { data: existingSessionRow, error: existingSessionErr } = await service
    .from("chat_sessions")
    .select("id")
    .eq("child_id", childId)
    .eq("session_type", "free")
    .eq("business_date", businessDate)
    .eq("conversation_window", conversationWindow)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSessionErr) {
    console.error("[chat/session] query error:", existingSessionErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (existingSessionRow) {
    return NextResponse.json({
      resumed: true,
      sessionId: existingSessionRow.id,
      businessDate,
      conversationWindow,
    });
  }

  const { data, error: rpcErr } = await service
    .rpc("get_or_create_chat_session", {
      p_child_id: childId,
      p_business_date: businessDate,
      p_conversation_window: conversationWindow
    })
    .single();

  const sessionData = data as { id: string; created: boolean } | null;

  if (rpcErr || !sessionData) {
    console.error("[chat/session] rpc error:", rpcErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({
    resumed: !sessionData.created,
    sessionId: sessionData.id,
    businessDate,
    conversationWindow,
  });
}
