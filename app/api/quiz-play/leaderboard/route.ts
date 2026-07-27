/**
 * GET /api/quiz-play/leaderboard[?childId=...]
 *
 * 리더보드는 아이(child_id) 단위 누적 랭킹이다. 시드(더미) 경쟁자와 실사용자는
 * 같은 quiz_leaderboard 테이블·같은 정렬 기준으로 함께 정렬된다(더미 전용 배열이나
 * 더미 전용 필터는 어디에도 없다).
 *
 * childId를 주면 그 아이의 본인 순위·누적점수·누적시간·완료횟수를 상위 목록 밖이어도
 * self로 따로 돌려준다. childId는 requireChildAccess로 반드시 검증한다 — 검증이 없으면
 * 남의 child_id를 넣어 그 아이의 순위를 조회할 수 있다.
 */

import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { getLeaderboardTop, getSelfEntry } from "@/lib/quiz/play/leaderboard";
import { apiError } from "@/lib/quiz/play/route-helpers";
import type { QuizLeaderboardResponse } from "@/lib/quiz/play/api-contracts";

export const runtime = "nodejs";

const LEADERBOARD_DISPLAY_LIMIT = 10;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return apiError("UNAUTHENTICATED");

  const requestedChildId = req.nextUrl.searchParams.get("childId");

  let childId: string | null = null;
  if (requestedChildId) {
    const access = await requireChildAccess(authClient, user.id, requestedChildId);
    if (!access.allowed) return apiError("FORBIDDEN");
    childId = requestedChildId;
  }

  let entries: QuizLeaderboardResponse["entries"] = [];
  let self: QuizLeaderboardResponse["self"] = null;
  try {
    [entries, self] = await Promise.all([
      getLeaderboardTop(LEADERBOARD_DISPLAY_LIMIT, childId),
      getSelfEntry(childId),
    ]);
  } catch {
    entries = [];
    self = null;
  }

  const response: QuizLeaderboardResponse = { entries, self };
  return NextResponse.json(response);
}
