/**
 * POST /api/rewards/golden-key/refund — 퀴즈마스터 환불 콜백 (requests/010 작업2)
 *
 * 퀴즈마스터가 attempt를 진행할 수 없게 됐을 때(연결 끊김/세션 오류/서버 오류 등)
 * 호출한다. 서버간 Bearer + Idempotency-Key 인증(lib/quiz/rewardCallbackAuth) 후,
 * quiz_handoff_tokens에서 이번 reward_transaction_id가 실제 발급된 거래인지, 요청의
 * user_id/child_id가 그 거래와 일치하는지 확인한 뒤, quiz 전용 신규 RPC
 * refund_gold_keys_by_consumption_id(2026-07-25 마이그레이션 추가, service_role 전용)로
 * 환불한다. quizmaster_attempt_id/reason은 RPC가 gold_key_consumptions에 원자적으로
 * 함께 기록하며, 이미 다른 attempt_id로 기록된 거래에 다른 값이 들어오면(변조/중복
 * 의심) RPC가 attempt_id_mismatch로 거부한다.
 *
 * MBTI 등 놀이 세션 기반 환불 RPC(refund_play_session/refund_gold_keys)는 이 라우트가
 * 전혀 호출하지 않는다 — quiz 전용 RPC로 완전히 분리돼 있다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRewardsCallbackAuth, sanitizeExternalText } from "@/lib/quiz/rewardCallbackAuth";

export const runtime = "nodejs";

interface RefundRequestBody {
  reward_transaction_id?: string;
  user_id?: string;
  child_id?: string | null;
  quizmaster_attempt_id?: string;
  reason?: string;
}

interface RefundRpcResult {
  success: boolean;
  refunded_count: number;
  header_id: string | null;
  reason: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: RefundRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rewardTransactionId = body.reward_transaction_id;
  if (!rewardTransactionId || !body.user_id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const authResult = verifyRewardsCallbackAuth(req, rewardTransactionId);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const supabase = createServiceClient();

  const { data: handoffRow, error: handoffErr } = await supabase
    .from("quiz_handoff_tokens")
    .select("user_id, child_id")
    .eq("reward_transaction_id", rewardTransactionId)
    .maybeSingle();

  if (handoffErr) {
    console.error("[POST /api/rewards/golden-key/refund] handoff lookup failed:", handoffErr);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!handoffRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (
    handoffRow.user_id !== body.user_id ||
    (body.child_id != null && handoffRow.child_id !== body.child_id)
  ) {
    console.error(
      "[POST /api/rewards/golden-key/refund] user_id/child_id mismatch for reward_transaction_id:",
      rewardTransactionId,
    );
    return NextResponse.json({ error: "ownership_mismatch" }, { status: 403 });
  }

  const externalAttemptId = sanitizeExternalText(body.quizmaster_attempt_id) ?? "";
  const refundReason = sanitizeExternalText(body.reason);

  const { data: rpcData, error: rpcErr } = await supabase.rpc("refund_gold_keys_by_consumption_id", {
    p_consumption_id: rewardTransactionId,
    p_external_attempt_id: externalAttemptId,
    p_refund_reason: refundReason,
  });

  if (rpcErr) {
    console.error("[POST /api/rewards/golden-key/refund] RPC error:", rpcErr);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const result = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as RefundRpcResult | undefined;
  if (!result) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (result.success) {
    return NextResponse.json({ refunded: true, refunded_count: result.refunded_count });
  }

  if (result.reason === "already_refunded") {
    // 010 "처리 조건": 이미 환불된 거래는 잔액을 추가하지 않고 성공(중복 처리) 응답을 반환한다.
    return NextResponse.json({ refunded: true, refunded_count: 0, reason: "already_refunded" });
  }

  if (result.reason === "attempt_id_mismatch") {
    console.error(
      "[POST /api/rewards/golden-key/refund] quizmaster_attempt_id mismatch (tamper/duplicate suspected):",
      rewardTransactionId,
    );
    return NextResponse.json({ refunded: false, reason: "attempt_id_mismatch" }, { status: 403 });
  }

  if (result.reason === "not_found" || result.reason === "nothing_to_refund") {
    return NextResponse.json({ refunded: false, reason: result.reason }, { status: 404 });
  }

  return NextResponse.json({ refunded: false, reason: result.reason }, { status: 500 });
}
