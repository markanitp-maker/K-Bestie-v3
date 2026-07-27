/**
 * POST /api/internal/play/exchange-ticket — MBTI 등 독립 놀이 서버 전용 API
 *
 * 브라우저는 절대 직접 호출할 수 없다(딥 인터뷰 Round 8-3) — `verifyInternalPlayRequest`
 * 로 놀이 프로젝트별 서버 전용 자격증명 + 타임스탬프를 검증한다. 1회용 실행 티켓을
 * 정확히 1회 교환해 playSessionId를 발급한다. 이 시점에는 황금열쇠를 아직 confirm하지
 * 않는다(딥 인터뷰 ⑤ — confirm은 /ready 호출 시점).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyInternalPlayRequest } from "@/lib/play/internalApiAuth";

export const runtime = "nodejs";

interface ExchangeTicketRequestBody {
  ticketToken?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = verifyInternalPlayRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: ExchangeTicketRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ticketToken = typeof body.ticketToken === "string" ? body.ticketToken : "";
  if (!ticketToken) {
    return NextResponse.json({ error: "ticketToken required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("exchange_play_execution_ticket", {
    p_ticket_token: ticketToken,
  });

  if (error || !data || data.length === 0) {
    console.error("[internal/exchange-ticket] RPC error:", error);
    return NextResponse.json({ error: "exchange_failed" }, { status: 500 });
  }

  const result = data[0] as {
    success: boolean;
    ticket_id: string | null;
    play_session_id: string | null;
    child_id: string | null;
    progress_state: unknown;
    reason: string;
  };

  if (!result.success) {
    const status = result.reason === "expired" || result.reason === "not_found" ? 410 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({
    playSessionId: result.play_session_id,
    childId: result.child_id,
    progressState: result.progress_state,
  });
}
