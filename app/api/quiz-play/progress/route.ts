/**
 * POST /api/quiz-play/progress — requests/021: 퀴즈마스터에서 포팅. 제출 전 자유
 * 이동/답안 변경 이벤트. answers를 병합하고 quiz_apply_signal RPC로 타이머 계산을
 * 반영한다. 정오답 피드백은 반환하지 않는다.
 */

import "server-only";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { apiError, parseJson, resolveAttempt } from "@/lib/quiz/play/route-helpers";
import type { QuizProgressRequest, QuizProgressResponse } from "@/lib/quiz/play/api-contracts";
import type { ApplySignalRow } from "@/lib/quiz/play/rpc-types";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseJson<QuizProgressRequest>(req);
  if (!body || typeof body.attemptId !== "string") {
    return apiError("INVALID_REQUEST", "attemptId is required");
  }

  const resolved = await resolveAttempt(body.attemptId);
  if (!resolved.ok) return resolved.response;
  const { attempt } = resolved;

  const hasAnswers = !!body.answers && typeof body.answers === "object";
  const mergedAnswers = hasAnswers ? { ...attempt.submitted_answers, ...body.answers } : attempt.submitted_answers;

  const position = typeof body.current_position === "number" ? body.current_position : null;
  const answersParam = hasAnswers ? mergedAnswers : null;
  const completedParam = hasAnswers ? Object.keys(mergedAnswers).length : null;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("quiz_apply_signal", {
    p_attempt_id: attempt.id,
    p_session_token: attempt.session_token,
    p_position: position,
    p_answers: answersParam,
    p_completed: completedParam,
  });
  if (error) return apiError("INTERNAL", error.message);

  const row = ((data ?? []) as ApplySignalRow[])[0];
  if (!row) return apiError("DEVICE_TAKEOVER");

  const response: QuizProgressResponse = {
    status: row.status,
    current_position: row.current_position,
    completed_count: row.completed_count,
    accumulated_time_seconds: row.accumulated_time_seconds,
  };
  return NextResponse.json(response);
}
