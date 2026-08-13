import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import { getAppEventEnvironment } from "@/lib/events/environment";
import { FREECHAT_DAILY_REWARD_TYPE } from "@/lib/freechat/dailyEngagementReward";
import { getKstBusinessDate } from "@/lib/utils/kstBusinessDate";

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
    .select("child_id, ended_at, session_type")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
  if (!accessibleSession) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (accessibleSession.session_type !== "free_chat") {
    return NextResponse.json({ error: "Invalid session type" }, { status: 400 });
  }

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

  let persistedEndedAt = accessibleSession.ended_at;
  if (!persistedEndedAt) {
    const requestedEndedAt = new Date().toISOString();
    const { data: endedSession, error: endSessionError } = await service
      .from("chat_sessions")
      .update({ ended_at: requestedEndedAt })
      .eq("id", sessionId)
      .is("ended_at", null)
      .select("ended_at")
      .maybeSingle();

    if (endSessionError) {
      console.error("[chat/pause] failed to persist completion timestamp", {
        sessionId,
        message: endSessionError.message,
      });
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    persistedEndedAt = endedSession?.ended_at ?? null;
    if (!persistedEndedAt) {
      const { data: concurrentSession, error: concurrentSessionError } = await service
        .from("chat_sessions")
        .select("ended_at")
        .eq("id", sessionId)
        .single();

      if (concurrentSessionError || !concurrentSession?.ended_at) {
        console.error("[chat/pause] failed to reconcile completion timestamp", {
          sessionId,
          message: concurrentSessionError?.message ?? "missing ended_at",
        });
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }
      persistedEndedAt = concurrentSession.ended_at;
    }
  }

  const completedAt = new Date(persistedEndedAt);
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
  const { count: activeBalance, error: balanceError } = await service
    .from("gold_key_ledger")
    .select("id", { count: "exact", head: true })
    .eq("child_id", accessibleSession.child_id)
    .eq("consumed", false)
    .gt("expires_at", new Date().toISOString());

  if (balanceError) {
    console.error("[chat/pause] active Gold Key balance lookup failed", {
      sessionId,
      message: balanceError.message,
    });
  }

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
      amount: rewardResult.rewarded ? 1 : 0,
      balance: balanceError ? null : (activeBalance ?? 0),
      rewardType: FREECHAT_DAILY_REWARD_TYPE,
      businessDate: getKstBusinessDate(completedAt),
      eventCount: rewardResult.event_count,
    },
  });
}
