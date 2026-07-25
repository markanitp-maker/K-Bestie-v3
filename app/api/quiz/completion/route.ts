/**
 * POST /api/quiz/completion — 퀴즈마스터 완료 콜백 (requests/010 작업3)
 *
 * quiz_submit_attempt가 첫 정상 제출을 확정한 뒤 딱 한 번 호출된다. 서버간
 * Bearer + Idempotency-Key 인증(lib/quiz/rewardCallbackAuth) 후, quiz_handoff_tokens로
 * 이 거래가 실제 발급된 것인지·user_id/child_id가 일치하는지 확인한다.
 *
 * 황금열쇠는 consume_gold_keys 시점에 이미 소비 확정('completed') 상태이므로 별도
 * 상태 전이가 필요 없다 — 점수 기반 추가 보상은 이번 구현 범위에 포함하지 않는다
 * (대표님 지시). 대신 010 "데이터 모델 검토"/테스트 시나리오 E가 요구하는 대로
 * quizmaster_attempt_id/score를 gold_key_consumptions에 실제로 저장한다(단순 로그가
 * 아님). 이미 다른 attempt_id로 기록된 거래에 다른 값이 들어오면(변조/중복 의심)
 * 거부한다. MBTI 쪽 코드/스키마는 이 라우트에서 전혀 참조하지 않는다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyRewardsCallbackAuth, sanitizeExternalText } from "@/lib/quiz/rewardCallbackAuth";

export const runtime = "nodejs";

interface CompletionRequestBody {
  reward_transaction_id?: string;
  user_id?: string;
  child_id?: string | null;
  quizmaster_attempt_id?: string;
  score?: number;
  completed_at?: string;
}

function isValidScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

// 010 §처리 조건 "completed_at ISO 8601 검증" — Date.parse는 "2026/07/25" 같은
// 비-ISO 형식도 통과시키는 느슨한 파서라 형식 자체를 정규식으로 먼저 강제한다.
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isValidIso8601(value: unknown): value is string {
  return typeof value === "string" && ISO_8601_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: CompletionRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rewardTransactionId = body.reward_transaction_id;
  if (!rewardTransactionId || !body.user_id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // 010 §처리 조건: "score 타입 및 허용 범위 검증", "completed_at ISO 8601 검증"
  if (!isValidScore(body.score)) {
    return NextResponse.json({ error: "invalid_score" }, { status: 400 });
  }
  if (!isValidIso8601(body.completed_at)) {
    return NextResponse.json({ error: "invalid_completed_at" }, { status: 400 });
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
    console.error("[POST /api/quiz/completion] handoff lookup failed:", handoffErr);
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
      "[POST /api/quiz/completion] user_id/child_id mismatch for reward_transaction_id:",
      rewardTransactionId,
    );
    return NextResponse.json({ error: "ownership_mismatch" }, { status: 403 });
  }

  const { data: consumption, error: consumeErr } = await supabase
    .from("gold_key_consumptions")
    .select("id, status, external_attempt_id")
    .eq("id", rewardTransactionId)
    .maybeSingle();

  if (consumeErr) {
    console.error("[POST /api/quiz/completion] consumption lookup failed:", consumeErr);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!consumption) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (consumption.status === "refunded") {
    // 010 "상태 전이": refunded → completed 불허. quizmaster 쪽 상호배타 가드(§4)상
    // 이론상 도달하지 않아야 하는 상태 — 방어적으로만 처리하고 별도 보상은 하지 않는다.
    console.error(
      "[POST /api/quiz/completion] completion arrived for an already-refunded consumption — anomaly:",
      rewardTransactionId,
    );
    return NextResponse.json({ error: "already_refunded" }, { status: 409 });
  }

  const externalAttemptId = sanitizeExternalText(body.quizmaster_attempt_id) ?? "";

  // 010 §보안 검증: quizmaster_attempt_id 변조/중복 의심 — 이미 다른 attempt_id로
  // 기록된 거래에 다른 값이 들어오면 거부한다.
  // SQL RPC(refund_gold_keys_by_consumption_id)의 IS NOT NULL 판단과 의미를 맞춘다 —
  // JS truthy 체크(&&)를 쓰면 빈 문자열(sentinel)이 NULL과 같이 취급돼 이 가드를
  // 조용히 우회할 수 있다(2026-07-25 claude-review 2차 지적).
  if (consumption.external_attempt_id != null && consumption.external_attempt_id !== externalAttemptId) {
    console.error(
      "[POST /api/quiz/completion] quizmaster_attempt_id mismatch (tamper/duplicate suspected):",
      rewardTransactionId,
    );
    return NextResponse.json({ error: "attempt_id_mismatch" }, { status: 403 });
  }

  const { error: updateErr } = await supabase
    .from("gold_key_consumptions")
    .update({
      external_attempt_id: externalAttemptId,
      completion_score: body.score,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rewardTransactionId);

  if (updateErr) {
    console.error("[POST /api/quiz/completion] failed to persist completion record:", updateErr);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  console.info("[POST /api/quiz/completion] quiz completed:", {
    rewardTransactionId,
    childId: handoffRow.child_id,
    quizmasterAttemptId: externalAttemptId,
    score: body.score,
    completedAt: body.completed_at,
  });

  return NextResponse.json({ ok: true });
}
