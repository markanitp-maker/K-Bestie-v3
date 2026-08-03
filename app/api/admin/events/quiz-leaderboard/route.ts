import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { fetchQuizLeaderboard } from "@/lib/events/quizLeaderboardClient";

export const runtime = "nodejs";

// GET /api/admin/events/quiz-leaderboard?period=2026-08
// fetchQuizLeaderboard가 퀴즈마스터와 공유하는 DB를 직접 읽어 마감 전/후를 모두 판단한다
// (2026-08-04 결정 — lib/events/quizLeaderboardClient.ts 주석 참고).
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const period = req.nextUrl.searchParams.get("period");
  if (!period) {
    return NextResponse.json({ error: "period required" }, { status: 400 });
  }

  const result = await fetchQuizLeaderboard(period);
  if (!result.ok) {
    return NextResponse.json({ period, status: "unavailable", error: result.error }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
