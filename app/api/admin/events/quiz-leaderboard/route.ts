import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getAppEventEnvironment } from "@/lib/events/environment";
import { fetchQuizLeaderboard } from "@/lib/events/quizLeaderboardClient";

export const runtime = "nodejs";

// GET /api/admin/events/quiz-leaderboard?period=2026-08
// 마감 전: 퀴즈마스터 내부 API로 현재 순위 조회. 마감 후(수신된 최종 스냅샷 존재):
// K-Bestie가 수신·저장한 kbestie_quiz_final_snapshots/entries 기준으로 반환.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const period = req.nextUrl.searchParams.get("period");
  if (!period) {
    return NextResponse.json({ error: "period required" }, { status: 400 });
  }

  const service = createServiceClient();
  const environment = getAppEventEnvironment();

  const { data: snapshot } = await service
    .from("kbestie_quiz_final_snapshots")
    .select("id, period_key, finalized_at, scoring_version, checksum")
    .eq("environment", environment)
    .eq("period_key", period)
    .maybeSingle();

  if (snapshot) {
    const { data: entries, error: entriesErr } = await service
      .from("kbestie_quiz_final_entries")
      .select("rank, child_id, score, correct_count, completed_quiz_count, is_seed_user, reward_eligible, reward_amount")
      .eq("snapshot_id", snapshot.id)
      .order("rank");

    if (entriesErr) {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({
      period,
      status: "finalized",
      finalizedAt: snapshot.finalized_at,
      scoringVersion: snapshot.scoring_version,
      entries,
    });
  }

  const result = await fetchQuizLeaderboard(period);
  if (!result.ok) {
    return NextResponse.json(
      { period, status: "unavailable", error: result.error, lastKnownGoodAt: result.lastKnownGoodAt ?? null },
      { status: 502 }
    );
  }

  return NextResponse.json({ ...result.data, period, status: "active" as const });
}
