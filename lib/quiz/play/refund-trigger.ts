import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { requestRefund } from "./rewardsCallback";

/**
 * requests/021 — 퀴즈마스터 프로젝트에서 포팅(createAdminClient→createServiceClient,
 * main-app-rewards→rewardsCallback 교체만, 나머지 로직/RPC 동일).
 *
 * "[버그 신고하기]"에서 트리거되는 중도 환불 경로 - 골드키 잔액은 절대 직접 건드리지
 * 않고, 이 attempt가 환불 대상인지만 판단해 1회성 가드를 통과한 뒤 기존
 * app/api/rewards/golden-key/refund로 결과를 보고한다.
 */
export type RefundTriggerOutcome =
  | {
      attempted: false;
      reason:
        | "no_session_id"
        | "attempt_not_found"
        | "not_owner"
        | "already_submitted"
        | "no_reward_transaction"
        | "already_requested";
    }
  | { attempted: true; result: "confirmed" | "failed" };

export async function triggerRefundIfEligible(params: {
  sessionId: string | null;
  userId: string;
  bugReportErrorCode: string;
}): Promise<RefundTriggerOutcome> {
  const { sessionId, userId, bugReportErrorCode } = params;
  if (!sessionId) return { attempted: false, reason: "no_session_id" };

  const supabase = createServiceClient();

  const { data: attempt, error } = await supabase
    .from("quiz_attempts")
    .select("id, user_id, status, reward_transaction_id, child_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(`triggerRefundIfEligible: ${error.message}`);
  if (!attempt) return { attempted: false, reason: "attempt_not_found" };
  if (attempt.user_id !== userId) return { attempted: false, reason: "not_owner" };
  if (attempt.status === "submitted") {
    return { attempted: false, reason: "already_submitted" };
  }
  if (!attempt.reward_transaction_id) {
    return { attempted: false, reason: "no_reward_transaction" };
  }

  const { data: won, error: guardError } = await supabase.rpc("quiz_mark_refund_requested", {
    p_attempt_id: attempt.id,
    p_user_id: userId,
  });
  if (guardError) throw new Error(`triggerRefundIfEligible: ${guardError.message}`);
  if (!won) return { attempted: false, reason: "already_requested" };

  const result = await requestRefund({
    reward_transaction_id: attempt.reward_transaction_id,
    user_id: userId,
    child_id: attempt.child_id,
    quizmaster_attempt_id: attempt.id,
    reason: bugReportErrorCode,
  });

  if (result.ok) {
    const { error: confirmError } = await supabase
      .from("quiz_attempts")
      .update({ refund_confirmed_at: new Date().toISOString() })
      .eq("id", attempt.id);
    if (confirmError) {
      console.error(
        `[reward-ownership] failed to record refund_confirmed_at for attempt ${attempt.id}: ${confirmError.message}`
      );
    }
    return { attempted: true, result: "confirmed" };
  }

  console.error(
    `[reward-ownership] refund callback failed for attempt ${attempt.id}: ${result.reason} - ${result.detail}`
  );
  return { attempted: true, result: "failed" };
}
