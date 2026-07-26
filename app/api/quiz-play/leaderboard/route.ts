/**
 * GET /api/quiz-play/leaderboard — requests/021 계열 포팅: 독립 퀴즈마스터 프로젝트의
 * /api/quiz/leaderboard와 동일하다. lib/quiz/play/leaderboard.ts(이미 포팅돼 있었으나
 * 호출하는 라우트가 없어 죽은 코드였음)를 그대로 사용한다.
 */

import "server-only";

import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/quiz/play/auth";
import { getLeaderboardTop } from "@/lib/quiz/play/leaderboard";
import { apiError } from "@/lib/quiz/play/route-helpers";
import type { QuizLeaderboardResponse } from "@/lib/quiz/play/api-contracts";

export const runtime = "nodejs";

const LEADERBOARD_DISPLAY_LIMIT = 10;

export async function GET(): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return apiError("UNAUTHENTICATED");

  let entries: QuizLeaderboardResponse["entries"] = [];
  try {
    entries = await getLeaderboardTop(LEADERBOARD_DISPLAY_LIMIT);
  } catch {
    entries = [];
  }

  const response: QuizLeaderboardResponse = { entries };
  return NextResponse.json(response);
}
