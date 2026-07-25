/**
 * POST /api/quiz-play/background — requests/021: 퀴즈마스터에서 포팅. 화면이
 * 백그라운드로 전환됐다는 신호(visibilitychange→hidden). 지금까지의 경과분을
 * 과금한 뒤 상태를 'background'로 표시한다. 백그라운드로 흐른 시간은 다음 신호에서
 * 전액 과금된다(절대 봐주지 않음).
 */

import "server-only";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { apiError, parseJson, resolveAttempt } from "@/lib/quiz/play/route-helpers";
import type { QuizBackgroundRequest, QuizBackgroundResponse } from "@/lib/quiz/play/api-contracts";
import type { EnterBackgroundRow } from "@/lib/quiz/play/rpc-types";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseJson<QuizBackgroundRequest>(req);
  if (!body || typeof body.attemptId !== "string") {
    return apiError("INVALID_REQUEST", "attemptId is required");
  }

  const resolved = await resolveAttempt(body.attemptId);
  if (!resolved.ok) return resolved.response;
  const { attempt } = resolved;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("quiz_enter_background", {
    p_attempt_id: attempt.id,
    p_session_token: attempt.session_token,
  });
  if (error) return apiError("INTERNAL", error.message);

  const row = ((data ?? []) as EnterBackgroundRow[])[0];
  const response: QuizBackgroundResponse = {
    status: "background",
    accumulated_time_seconds: row?.accumulated_time_seconds ?? attempt.accumulated_time_seconds,
  };
  return NextResponse.json(response);
}
