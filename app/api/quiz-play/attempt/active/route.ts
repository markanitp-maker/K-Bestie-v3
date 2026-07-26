/**
 * GET /api/quiz-play/attempt/active — requests/021 계열 포팅: 독립 퀴즈마스터
 * 프로젝트의 /api/quiz/attempt/active와 동일하다(auth만 K-Bestie 세션으로 교체,
 * RPC/테이블 로직은 원본 그대로). attemptId를 몰라도 이 사용자의 재개 가능한
 * attempt(status in_progress|background, 6시간 이내)를 찾아준다.
 *
 * 이 엔드포인트가 언제 호출돼야 하는지(예: 놀이 목록에서 이어하기 여부를 판단하는
 * 시점)는 메인 앱의 진입 오케스트레이션 책임이다 — docs/quiz-inapp-integration.md
 * §5 참고. 이 라우트는 그 판단에 필요한 조회 능력만 제공한다.
 */

import "server-only";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getAuthenticatedUserId } from "@/lib/quiz/play/auth";
import { ATTEMPT_MAX_AGE_MS, apiError } from "@/lib/quiz/play/route-helpers";
import type { QuizAttemptActiveResponse } from "@/lib/quiz/play/api-contracts";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return apiError("UNAUTHENTICATED");

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - ATTEMPT_MAX_AGE_MS).toISOString();

  const { data, error } = await supabase
    .from("quiz_attempts")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["in_progress", "background"])
    .gt("started_at", cutoff)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return apiError("INTERNAL", error.message);

  const response: QuizAttemptActiveResponse = {
    attemptId: (data as { id: string } | null)?.id ?? null,
  };
  return NextResponse.json(response);
}
