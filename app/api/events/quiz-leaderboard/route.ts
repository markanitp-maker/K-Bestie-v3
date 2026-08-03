import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuizLeaderboard } from "@/lib/events/quizLeaderboardClient";

export const runtime = "nodejs";

// GET /api/events/quiz-leaderboard?period=2026-08 — 아이/부모/관리자 화면 공용 조회.
// 퀴즈마스터와 동일 물리 Supabase DB를 공유하므로 fetchQuizLeaderboard가 서버에서
// 직접 테이블을 읽는다(HTTP 왕복 없음, 2026-08-04 결정 — 아래 클라이언트 주석 참고).
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
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
