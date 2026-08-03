import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuizLeaderboard } from "@/lib/events/quizLeaderboardClient";

export const runtime = "nodejs";

// GET /api/events/quiz-leaderboard?period=2026-08 — 아이/부모/관리자 화면 공용 조회.
// 브라우저는 이 라우트만 호출한다 — 퀴즈마스터 원본 URL은 절대 노출되지 않는다
// (fetchQuizLeaderboard가 서버에서만 QUIZ_UPSTREAM_ORIGIN을 사용).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const period = req.nextUrl.searchParams.get("period");
  if (!period) {
    return NextResponse.json({ error: "period required" }, { status: 400 });
  }

  const result = await fetchQuizLeaderboard(period);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, lastKnownGoodAt: result.lastKnownGoodAt ?? null },
      { status: 502 }
    );
  }

  return NextResponse.json(result.data);
}
