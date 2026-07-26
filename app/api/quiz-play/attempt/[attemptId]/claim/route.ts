/**
 * POST /api/quiz-play/attempt/[attemptId]/claim — requests/021 계열 포팅: 독립
 * 퀴즈마스터 프로젝트의 /api/quiz/attempt/[attemptId]/claim과 동일하다(기기 전환
 * 재접속). 새 기기/새 진입이 이 attempt의 기존 session_token을 모르는 상태에서도
 * 게이트1(K-Bestie 로그인 세션)만으로 소유권·만료·제출여부를 확인한 뒤
 * session_token/device_id를 원자적으로 교체해 이 기기로 잠금을 넘긴다. 황금열쇠/
 * handoff token과는 무관한 순수 재인증이다.
 */

import "server-only";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getAuthenticatedUserId } from "@/lib/quiz/play/auth";
import {
  generateDeviceId,
  generateSessionToken,
  setSessionToken,
} from "@/lib/quiz/play/session-cookie";
import {
  ATTEMPT_MAX_AGE_MS,
  apiError,
  buildHydrationPayload,
} from "@/lib/quiz/play/route-helpers";
import type { QuizAttemptRow } from "@/lib/quiz/play/types";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ attemptId: string }> }
): Promise<NextResponse> {
  const { attemptId } = await ctx.params;

  const userId = await getAuthenticatedUserId();
  if (!userId) return apiError("UNAUTHENTICATED");

  const supabase = createServiceClient();

  const { data: attemptData, error: fetchError } = await supabase
    .from("quiz_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();
  if (fetchError) return apiError("INTERNAL", fetchError.message);
  if (!attemptData) return apiError("ATTEMPT_NOT_FOUND");

  const attempt = attemptData as QuizAttemptRow;

  if (attempt.user_id !== userId) return apiError("FORBIDDEN");

  if (Date.now() - new Date(attempt.started_at).getTime() > ATTEMPT_MAX_AGE_MS) {
    return apiError("ATTEMPT_EXPIRED");
  }

  if (attempt.status === "submitted") {
    return apiError("ATTEMPT_ALREADY_SUBMITTED", "attempt already submitted");
  }

  const newToken = generateSessionToken();
  const newDeviceId = generateDeviceId();
  const { data: swapped, error: swapError } = await supabase
    .from("quiz_attempts")
    .update({ session_token: newToken, device_id: newDeviceId })
    .eq("id", attemptId)
    .eq("user_id", userId)
    .in("status", ["in_progress", "background"])
    .select("*")
    .maybeSingle();
  if (swapError) return apiError("INTERNAL", swapError.message);
  if (!swapped) return apiError("ATTEMPT_EXPIRED"); // no longer resumable (race)

  await setSessionToken(newToken);

  const hydration = await buildHydrationPayload(swapped as QuizAttemptRow);
  if (!hydration.ok) return hydration.response;

  return NextResponse.json(hydration.payload);
}
