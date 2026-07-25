/**
 * POST /api/quiz-play/bug-report — requests/021: 퀴즈마스터에서 포팅. "[버그
 * 신고하기]" 백엔드. 진행 단계 어디서든(redeem/subject_select/quiz_engine/submit)
 * 신고 가능 - session_id는 attempt가 아직 없는 단계면 null일 수 있다.
 *
 * user_id는 항상 K-Bestie 인증 세션에서 직접 도출한다 - 클라이언트가 보낸 값을
 * 신뢰하지 않는다. 신고 저장 자체가 이 API의 핵심 목적이므로, 그 이후의 환불
 * 트리거(triggerRefundIfEligible, 기존 /api/rewards/golden-key/refund 그대로 호출)
 * 실패는 신고 저장 성공을 절대 무효화하지 않는다.
 */

import "server-only";

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parseBugReportPayload } from "@/lib/quiz/play/bug-report";
import { triggerRefundIfEligible } from "@/lib/quiz/play/refund-trigger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseBugReportPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("quiz_bug_reports")
    .insert({
      session_id: parsed.data.session_id,
      user_id: user.id,
      location: parsed.data.location,
      error_code: parsed.data.error_code,
      detail_log: parsed.data.detail_log,
      block_reason: parsed.data.block_reason,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Failed to save bug report: ${error.message}` },
      { status: 500 }
    );
  }

  try {
    await triggerRefundIfEligible({
      sessionId: parsed.data.session_id,
      userId: user.id,
      bugReportErrorCode: parsed.data.error_code,
    });
  } catch (err) {
    console.error(
      `[reward-ownership] triggerRefundIfEligible threw for bug report ${data.id}:`,
      err
    );
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
