import { NextRequest, NextResponse } from "next/server";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { resolveMissionPolicyVersion } from "@/lib/mission-v3/policyResolution";
import { buildGoalProgress, fetchMissionGoals } from "@/lib/mission-v3/routeSupport";
import { decideDailySingleOperation } from "@/lib/mission-v3/timePolicy";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set(["COMPLETED", "SAFETY_PAUSED", "FORCE_ENDED"]);

export async function GET(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = new URL(req.url).searchParams.get("childId")?.trim() ?? "";
  if (!UUID_PATTERN.test(childId)) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const access = await requireChildAccess(authClient, user.id, childId);
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const resolvedPolicy = resolveMissionPolicyVersion(now);
  const service = createServiceClient();
  let operation: Awaited<ReturnType<typeof decideDailySingleOperation>>;
  try {
    operation = await decideDailySingleOperation({
      db: service,
      childId,
      policy: {
        missionPolicyVersion: resolvedPolicy.version,
        effectiveAt: resolvedPolicy.effectiveAt,
      },
      now,
    });
  } catch (error) {
    console.error("[mission/v3/today-progress] 정책 판정 실패", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  const { data: progress, error: progressError } = await service
    .from("mission_progress")
    .select("session_id, status, business_date, round_type, mission_policy_version, effective_at")
    .eq("child_id", childId)
    .eq("business_date", operation.businessDate)
    .eq("round_type", "daily_single")
    .maybeSingle();
  if (progressError) {
    console.error("[mission/v3/today-progress] 진행정보 조회 실패", progressError.message);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  let goalProgress = null;
  if (progress?.session_id) {
    try {
      goalProgress = buildGoalProgress(await fetchMissionGoals(service, progress.session_id));
    } catch (error) {
      console.error("[mission/v3/today-progress] Goal 진행 조회 실패", error);
      return NextResponse.json({ error: "서버 오류" }, { status: 500 });
    }
  }

  return NextResponse.json({
    policyVersion: resolvedPolicy.version,
    effectiveAt: resolvedPolicy.effectiveAt,
    businessDate: operation.businessDate,
    hasMission: Boolean(progress),
    sessionId: progress?.session_id ?? null,
    status: progress?.status ?? null,
    completed: progress?.status === "COMPLETED",
    roundType: progress?.round_type ?? "daily_single",
    operation: operation.action,
    canStart: !TERMINAL_STATUSES.has(progress?.status ?? "")
      && (operation.action === "create" || operation.action === "resume"),
    blockReason: operation.action === "blocked" ? operation.reason : null,
    timeGate: "gate" in operation ? operation.gate ?? null : null,
    goalProgress,
  });
}
