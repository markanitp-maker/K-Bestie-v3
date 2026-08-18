import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import { evaluateRelationshipStage } from "@/lib/relationship/stageEvaluation";
import { persistRelationshipStage } from "@/lib/relationship/persistStage";
import { checkAndRecordReturnedAfterGap } from "@/lib/relationship/relationshipEvents";
import {
  FREECHAT_DAILY_KEY_REWARD_TYPE,
  buildFreechatDailyKeyStatus,
} from "@/lib/freechat/dailyKeyStatus";

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

    try {
      const evaluated = await evaluateRelationshipStage({ db: service, childId });
      await persistRelationshipStage({ db: service, childId, sessionId: sessionData.id, evaluated });
      await checkAndRecordReturnedAfterGap({
        db: service,
        childId,
        sessionId: sessionData.id,
        currentBusinessDate: businessDate,
        familyId: childData?.family_id,
      });
    } catch (error) {
      console.error("[chat/session] 관계 판정/저장 실패:", error);
    }
  }

  // 요청서 011 — 오늘 자유대화 황금열쇠 획득 여부를 함께 돌려준다.
  // 별도 read endpoint 를 만들지 않고 이미 진입 때 호출되는 이 API 를 확장한다(§3-5).
  // Source of Truth 는 gold_key_ledger 이며 판정 조건은
  // child_id + reward_type='freechat_daily_engagement' + 같은 KST business_date 뿐이다.
  // 조회가 실패해도 대화는 그대로 시작할 수 있어야 하므로 상태만 null 로 내려보낸다(§3-12).
  let dailyKeyStatus = null;
  try {
    const { data: keyRow, error: keyErr } = await service
      .from("gold_key_ledger")
      .select("earned_at")
      .eq("child_id", childId)
      .eq("reward_type", FREECHAT_DAILY_KEY_REWARD_TYPE)
      .eq("business_date", businessDate)
      .order("earned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (keyErr) {
      console.error("[chat/session] 오늘 자유대화 황금열쇠 조회 실패:", keyErr);
    } else {
      dailyKeyStatus = buildFreechatDailyKeyStatus(keyRow, businessDate);
    }
  } catch (error) {
    console.error("[chat/session] 오늘 자유대화 황금열쇠 조회 예외:", error);
  }

  return NextResponse.json({
    resumed: !sessionData.created,
    sessionId: sessionData.id,
    businessDate,
    conversationWindow,
    dailyKeyStatus,
  });
}
