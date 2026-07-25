/**
 * POST /api/quiz-play/submit — requests/021: 퀴즈마스터에서 포팅. attempt를
 * 확정한다. 서버에서 점수를 계산(option_order로 표시 슬롯→원본 인덱스 역매핑)하고
 * quiz_submit_attempt RPC로 최종 타이머 반영+점수 기록+status 전환(+리더보드 upsert,
 * identity 있을 때만)을 원자적으로 처리한다. 멱등적 - 중복 제출은 이미 저장된 결과를
 * already_submitted=true로 반환하고 중복 집계하지 않는다.
 *
 * 완료 시 기존 app/api/quiz/completion(변경 없음)을 그대로 호출해 "완료 콜백" 계약을
 * 유지한다 - 골드키는 이미 consume_gold_keys 시점에 소비 확정 상태이므로 이 호출은
 * quizmaster_attempt_id/score 기록 + 상태 확정 목적이다.
 */

import "server-only";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getLeaderboardIdentity } from "@/lib/quiz/play/profile";
import { getRankForUser } from "@/lib/quiz/play/leaderboard";
import { scoreAttempt } from "@/lib/quiz/play/scoring";
import { notifyCompletion } from "@/lib/quiz/play/rewardsCallback";
import { apiError, parseJson, resolveAttempt } from "@/lib/quiz/play/route-helpers";
import type { QuizSubmitRequest, QuizSubmitResponse } from "@/lib/quiz/play/api-contracts";
import type { SubmitAttemptRow } from "@/lib/quiz/play/rpc-types";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseJson<QuizSubmitRequest>(req);
  if (!body || typeof body.attemptId !== "string") {
    return apiError("INVALID_REQUEST", "attemptId is required");
  }

  const resolved = await resolveAttempt(body.attemptId);
  if (!resolved.ok) return resolved.response;
  const { userId, attempt } = resolved;

  const hasAnswers = !!body.answers && typeof body.answers === "object";
  const mergedAnswers = hasAnswers ? { ...attempt.submitted_answers, ...body.answers } : attempt.submitted_answers;

  const supabase = createServiceClient();

  const { data: keyRows, error: keyError } = await supabase
    .from("quiz_question_bank")
    .select("id, correct_option_index")
    .in("id", attempt.selected_questions);
  if (keyError) return apiError("INTERNAL", keyError.message);

  const correctByQuestionId: Record<string, number> = {};
  for (const r of (keyRows ?? []) as Array<{ id: string; correct_option_index: number }>) {
    correctByQuestionId[r.id] = r.correct_option_index;
  }

  const { score } = scoreAttempt({
    selectedQuestions: attempt.selected_questions,
    submittedAnswers: mergedAnswers,
    optionOrder: attempt.option_order,
    correctByQuestionId,
  });

  const identity = await getLeaderboardIdentity(userId);

  const { data, error } = await supabase.rpc("quiz_submit_attempt", {
    p_attempt_id: attempt.id,
    p_session_token: attempt.session_token,
    p_score: score,
    p_name: identity?.name ?? null,
    p_login_id: identity?.login_id ?? null,
  });
  if (error) return apiError("INTERNAL", error.message);

  const row = ((data ?? []) as SubmitAttemptRow[])[0];
  if (!row || row.result_found === false) return apiError("DEVICE_TAKEOVER");

  let rank: number | null = null;
  try {
    rank = await getRankForUser(userId);
  } catch {
    rank = null;
  }

  const finalScore = row.result_score ?? score;
  const finalAccumulated = row.result_accumulated_time ?? attempt.accumulated_time_seconds;

  if (!row.result_already_submitted && attempt.reward_transaction_id) {
    try {
      const result = await notifyCompletion({
        reward_transaction_id: attempt.reward_transaction_id,
        user_id: userId,
        child_id: attempt.child_id,
        quizmaster_attempt_id: attempt.id,
        score: finalScore,
        completed_at: new Date().toISOString(),
      });
      if (result.ok) {
        const { error: notifyRecordError } = await supabase
          .from("quiz_attempts")
          .update({ completion_notified_at: new Date().toISOString() })
          .eq("id", attempt.id);
        if (notifyRecordError) {
          console.error(
            `[reward-ownership] failed to record completion_notified_at for attempt ${attempt.id}: ${notifyRecordError.message}`
          );
        }
      } else {
        console.error(
          `[reward-ownership] completion-notify failed for attempt ${attempt.id}: ${result.reason} - ${result.detail}`
        );
      }
    } catch (err) {
      console.error(`[reward-ownership] notifyCompletion threw for attempt ${attempt.id}:`, err);
    }
  }

  const response: QuizSubmitResponse = {
    score: finalScore,
    accumulated_time_seconds: finalAccumulated,
    cumulative_score: row.result_cumulative_score,
    cumulative_time: row.result_cumulative_time,
    rank,
    status: "submitted",
    already_submitted: row.result_already_submitted,
  };
  return NextResponse.json(response);
}
