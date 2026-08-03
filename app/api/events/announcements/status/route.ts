import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveChildForUser } from "@/lib/child/testAccount";
import { APP_EVENTS_ANNOUNCEMENT_KEY, APP_EVENTS_ANNOUNCEMENT_VERSION } from "@/lib/events/announcementConfig";
import { getAppEventEnvironment } from "@/lib/events/environment";
import { missionOnboardingRewardTier } from "@/lib/events/rewardTier";

export const runtime = "nodejs";

// GET /api/events/announcements/status — 로그인 후 이벤트 안내 팝업을 띄울지 서버가 판정한다.
// audience(아이/부모)는 클라이언트가 주장하지 않고 family_members.role로 서버가 직접 판별한다.
// 조회 실패가 로그인 자체를 막으면 안 되므로(§6.1), 내부 오류 시에도 shouldShow=false로
// 안전하게 응답한다(팝업 없이 로그인은 계속 진행).
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ shouldShow: false });

    const service = createServiceClient();
    const environment = getAppEventEnvironment();
    const childInfo = await resolveChildForUser(service, user.id);
    const audience: "child" | "parent" = childInfo ? "child" : "parent";

    const ackQuery = service
      .from("event_announcement_acknowledgements")
      .select("id")
      .eq("announcement_key", APP_EVENTS_ANNOUNCEMENT_KEY)
      .eq("announcement_version", APP_EVENTS_ANNOUNCEMENT_VERSION)
      .eq("audience_type", audience);
    const { data: ack } = audience === "child"
      ? await ackQuery.eq("child_id", childInfo!.childId).maybeSingle()
      : await ackQuery.eq("parent_user_id", user.id).maybeSingle();

    if (ack) {
      return NextResponse.json({ shouldShow: false });
    }

    if (audience === "child") {
      const { data: event } = await service
        .from("child_mission_onboarding_events")
        .select("status, mission_completed_count, current_reward_amount, ends_at")
        .eq("environment", environment)
        .eq("child_id", childInfo!.childId)
        .maybeSingle();

      return NextResponse.json({
        shouldShow: true,
        audience,
        announcementKey: APP_EVENTS_ANNOUNCEMENT_KEY,
        announcementVersion: APP_EVENTS_ANNOUNCEMENT_VERSION,
        missionEvent: event
          ? {
              status: event.status,
              completedCount: event.mission_completed_count,
              currentRewardAmount: event.current_reward_amount,
              nextTierRemaining: nextTierRemaining(event.mission_completed_count),
              endsAt: event.ends_at,
            }
          : { status: "not_started" },
      });
    }

    // 부모: 자녀별 상태 요약(RLS로 이미 본인 가족 범위로 제한됨).
    const { data: children } = await supabase
      .from("child_profiles")
      .select("id, name");

    const childIds = (children ?? []).map((c) => c.id);
    const { data: events } = childIds.length
      ? await service
          .from("child_mission_onboarding_events")
          .select("child_id, status, mission_completed_count, current_reward_amount, ends_at")
          .eq("environment", environment)
          .in("child_id", childIds)
      : { data: [] };

    const eventByChild = new Map((events ?? []).map((e) => [e.child_id, e]));
    const summaries = (children ?? []).map((c) => {
      const e = eventByChild.get(c.id);
      return {
        childId: c.id,
        name: c.name,
        missionEvent: e
          ? {
              status: e.status,
              completedCount: e.mission_completed_count,
              currentRewardAmount: e.current_reward_amount,
              endsAt: e.ends_at,
            }
          : { status: "not_started" },
      };
    });

    return NextResponse.json({
      shouldShow: true,
      audience,
      announcementKey: APP_EVENTS_ANNOUNCEMENT_KEY,
      announcementVersion: APP_EVENTS_ANNOUNCEMENT_VERSION,
      children: summaries,
    });
  } catch (err) {
    console.error("[announcements/status] error:", (err as Error).message);
    return NextResponse.json({ shouldShow: false });
  }
}

function nextTierRemaining(count: number): { nextTier: number; remaining: number } | null {
  const tiers = [10, 30, 50, 60];
  const next = tiers.find((t) => count < t);
  if (!next) return null;
  return { nextTier: missionOnboardingRewardTier(next), remaining: next - count };
}
