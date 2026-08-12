import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { getKstHour, currentRound } from "@/lib/mission/missionTimeGate";
import { isMissionScheduleEnforced } from "@/lib/mission/missionScheduleFlag";

export const runtime = "nodejs";

// Historical v2 round progress endpoint. Mission v3 clients use
// /api/mission/v3/today-progress.

export async function GET(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const childId = url.searchParams.get("childId");
  if (!childId) return NextResponse.json({ error: "childId required" }, { status: 400 });

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
  const startOfDayKst = new Date(`${businessDate}T00:00:00+09:00`).toISOString();
  const endOfDayKst = new Date(`${businessDate}T23:59:59.999+09:00`).toISOString();
  // activeRound: 실제 시간 게이트 판정용(round1_day/round2_night가 아니면 null).
  // currentRound: 화면 표시·문항 조회용 기본값(게이트가 닫혀도 "common"으로 폴백).
  // 둘을 분리한 이유: activeRound가 항상 "common"으로 폴백되면 시간 제한 기능(!activeRound
  // 체크)이 절대 발동하지 않는 버그가 생긴다.
  const scheduleEnforced = isMissionScheduleEnforced();
  const activeRound = currentRound(getKstHour(), scheduleEnforced);
  const roundNow = activeRound ?? "common";

  const svc = createServiceClient();
  // mission/start.ts와 동일하게 round_type으로 세션을 구분한다 — 하루 2라운드 정책에서
  // round_type 필터 없이 "오늘 최신 세션"만 보면 낮 라운드를 완료한 뒤 밤 라운드에 진입해도
  // 낮 세션의 완료 상태가 그대로 노출되는 버그가 생긴다.
  const { data: sessionRow, error: sessionErr } = await svc
    .from("chat_sessions")
    .select("id, mission_progress!inner(status, valid_answer_count, required_valid_count, round_type)")
    .eq("child_id", childId)
    .eq("session_type", "mission")
    .eq("mission_progress.round_type", roundNow)
    .gte("started_at", startOfDayKst)
    .lte("started_at", endOfDayKst)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionErr) {
    console.error("[mission/today-progress] session query failed:", sessionErr);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  if (!sessionRow) {
    return NextResponse.json({ hasMission: false, currentRound: roundNow, activeRound, scheduleEnforced });
  }

  const progress = Array.isArray(sessionRow.mission_progress) ? sessionRow.mission_progress[0] : sessionRow.mission_progress;
  return NextResponse.json({
    hasMission: true,
    status: progress?.status,
    validAnswerCount: progress?.valid_answer_count ?? 0,
    requiredCount: progress?.required_valid_count ?? 10,
    roundType: progress?.round_type,
    currentRound: roundNow,
    activeRound,
    scheduleEnforced
  });
}
