import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

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

  const approvalBlocked = await checkApprovalForChild(childId);
  if (approvalBlocked) return approvalBlocked;

  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const yyyy = kstNow.getUTCFullYear();
  const mm = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstNow.getUTCDate()).padStart(2, '0');
  const businessDate = `${yyyy}-${mm}-${dd}`;
  const conversationWindow = kstNow.getUTCHours() < 18 ? 'day' : 'evening';

  const service = createServiceClient();


  const { data, error: rpcErr } = await service
    .rpc("get_or_create_chat_session", {
      p_child_id: childId,
      p_business_date: businessDate,
      p_conversation_window: conversationWindow
    })
    .single();

  const sessionData = data as { id: string; created: boolean } | null;

  if (rpcErr || !sessionData) {
    console.error("[chat/session] rpc error:", rpcErr, { businessDate, conversationWindow });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  console.log("[chat/session] result", { childId, businessDate, conversationWindow, sessionId: sessionData.id, resumed: !sessionData.created });

  if (sessionData.created) {
    const { data: childData } = await service.from("child_profiles").select("family_id").eq("id", childId).single();
    await logBehaviorEvent({
      eventName: "freechat_start",
      actorType: "child",
      childId,
      familyId: childData?.family_id,
      sessionId: sessionData.id,
      feature: "freechat",
      route: "/api/chat/session",
    }).catch(() => {});
  }

  return NextResponse.json({
    resumed: !sessionData.created,
    sessionId: sessionData.id,
    businessDate,
    conversationWindow,
  });
}
