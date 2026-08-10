import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import { getAppEventEnvironment } from "@/lib/events/environment";

export const runtime = "nodejs";

interface FreechatEngagementResult {
  rewarded: boolean;
  eligible: boolean;
  reason: string;
  meaningful_turn_count: number;
  distinct_meaningful_turn_count: number;
  duration_seconds: number;
  event_count: number | null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; turnCount?: number; ended?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { sessionId, turnCount, ended } = body;
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const normalizedTurnCount =
    typeof turnCount === "number" && Number.isInteger(turnCount) && turnCount >= 0
      ? turnCount
      : 0;

  // 먼저 사용자 권한이 적용되는 client로 세션 접근 가능 여부를 확인한다. 이후
  // service-role RPC도 이 검증을 통과한 세션 id에만 호출한다.
  const { data: accessibleSession, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("child_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
  if (!accessibleSession) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const service = createServiceClient();
  const { data: child } = await service
    .from("child_profiles")
    .select("member_id")
    .eq("id", accessibleSession.child_id)
    .maybeSingle();
  if (!child?.member_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: childMember } = await service
    .from("family_members")
    .select("user_id")
    .eq("id", child.member_id)
    .maybeSingle();
  if (childMember?.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!ended) {
    const { error } = await supabase
      .from("chat_sessions")
      .update({ turn_count: normalizedTurnCount })
      .eq("id", sessionId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const completedAt = new Date();
  const { data: rewardData, error: rewardError } = await service
    .rpc("complete_freechat_daily_engagement", {
      p_child_id: accessibleSession.child_id,
      p_environment: getAppEventEnvironment(),
      p_source_session_id: sessionId,
      p_turn_count: normalizedTurnCount,
      p_completed_at: completedAt.toISOString(),
    })
    .single();

  if (rewardError || !rewardData) {
    console.error("[chat/pause] complete_freechat_daily_engagement failed", {
      sessionId,
      message: rewardError?.message ?? "empty RPC response",
    });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const rewardResult = rewardData as FreechatEngagementResult;

  const { data: childData } = await service
    .from("child_profiles")
    .select("family_id")
    .eq("id", accessibleSession.child_id)
    .single();
  await logBehaviorEvent({
    eventName: "freechat_complete",
    actorType: "child",
    childId: accessibleSession.child_id,
    familyId: childData?.family_id,
    sessionId,
    durationSeconds: rewardResult.duration_seconds,
    feature: "freechat",
    route: "/api/chat/pause",
    properties: {
      rewardEligible: rewardResult.eligible,
      rewardEarned: rewardResult.rewarded,
      rewardReason: rewardResult.reason,
      meaningfulTurnCount: rewardResult.meaningful_turn_count,
      distinctMeaningfulTurnCount: rewardResult.distinct_meaningful_turn_count,
    },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    reward: {
      earned: rewardResult.rewarded,
      eligible: rewardResult.eligible,
      reason: rewardResult.reason,
      eventCount: rewardResult.event_count,
    },
  });
}
