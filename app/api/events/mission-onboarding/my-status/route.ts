import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveChildForUser } from "@/lib/child/testAccount";
import { getAppEventEnvironment } from "@/lib/events/environment";
import { missionOnboardingRewardTier } from "@/lib/events/rewardTier";
import { lazyFinalizeIfDue } from "@/lib/events/missionOnboardingRead";

export const runtime = "nodejs";

// GET /api/events/mission-onboarding/my-status — 홈 화면 상시 진행 카드용(팝업과 무관,
// acknowledgement 상태와 무관하게 항상 현재 상태를 반환한다). 아이면 본인 이벤트,
// 부모면 자녀별 이벤트 목록을 반환한다.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const environment = getAppEventEnvironment();
  const childInfo = await resolveChildForUser(service, user.id);

  if (childInfo) {
    const { data: event } = await service
      .from("child_mission_onboarding_events")
      .select("id, status, mission_completed_count, current_reward_amount, final_reward_amount, final_mission_count, started_at, ends_at, completed_at")
      .eq("environment", environment)
      .eq("child_id", childInfo.childId)
      .maybeSingle();

    if (!event) {
      return NextResponse.json({ audience: "child", missionEvent: { status: "not_started" } });
    }

    await lazyFinalizeIfDue(service, event.id, event.ends_at, event.status);
    const { data: freshEvent } = await service
      .from("child_mission_onboarding_events")
      .select("status, mission_completed_count, current_reward_amount, final_reward_amount, final_mission_count, started_at, ends_at, completed_at")
      .eq("id", event.id)
      .single();
    const current = freshEvent ?? event;

    const tiers = [10, 30, 50, 60];
    const next = tiers.find((t) => current.mission_completed_count < t);
    const nextTierRemaining = next
      ? { nextTier: missionOnboardingRewardTier(next), remaining: next - current.mission_completed_count }
      : null;

    return NextResponse.json({
      audience: "child",
      missionEvent: { ...current, nextTierRemaining },
    });
  }

  // 부모: RLS로 이미 본인 가족 범위로 제한된 children 목록 + 이벤트 상태.
  const { data: children } = await supabase.from("child_profiles").select("id, name");
  const childIds = (children ?? []).map((c) => c.id);
  const { data: events } = childIds.length
    ? await service
        .from("child_mission_onboarding_events")
        .select("id, child_id, status, mission_completed_count, current_reward_amount, final_reward_amount, started_at, ends_at")
        .eq("environment", environment)
        .in("child_id", childIds)
    : { data: [] };

  await Promise.all((events ?? []).map((e) => lazyFinalizeIfDue(service, e.id, e.ends_at, e.status)));

  const eventByChild = new Map((events ?? []).map((e) => [e.child_id, e]));
  const summaries = (children ?? []).map((c) => ({
    childId: c.id,
    name: c.name,
    missionEvent: eventByChild.get(c.id) ?? { status: "not_started" },
  }));

  return NextResponse.json({ audience: "parent", children: summaries });
}
