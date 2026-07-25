/**
 * POST /api/quiz-play/heartbeat — requests/021: 퀴즈마스터에서 포팅. 전면(foreground)
 * 상태에서 ~30초 주기 생존 신호. quiz_apply_signal로 마지막 신호 이후 경과분을 과금한다.
 */

import "server-only";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { apiError, parseJson, resolveAttempt } from "@/lib/quiz/play/route-helpers";
import type { QuizHeartbeatRequest, QuizHeartbeatResponse } from "@/lib/quiz/play/api-contracts";
import type { ApplySignalRow } from "@/lib/quiz/play/rpc-types";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseJson<QuizHeartbeatRequest>(req);
  if (!body || typeof body.attemptId !== "string") {
    return apiError("INVALID_REQUEST", "attemptId is required");
  }

  const resolved = await resolveAttempt(body.attemptId);
  if (!resolved.ok) return resolved.response;
  const { attempt } = resolved;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("quiz_apply_signal", {
    p_attempt_id: attempt.id,
    p_session_token: attempt.session_token,
    p_position: null,
    p_answers: null,
    p_completed: null,
  });
  if (error) return apiError("INTERNAL", error.message);

  const row = ((data ?? []) as ApplySignalRow[])[0];
  if (!row) return apiError("DEVICE_TAKEOVER");

  const response: QuizHeartbeatResponse = {
    status: row.status,
    accumulated_time_seconds: row.accumulated_time_seconds,
  };
  return NextResponse.json(response);
}
