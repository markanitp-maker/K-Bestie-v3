/**
 * POST /api/internal/play/ready — MBTI 등 독립 놀이 서버 전용 API
 *
 * 독립 놀이 서버가 "실제로 사용자에게 화면을 보여줄 준비가 됐다"고 알리는 시점.
 * 딥 인터뷰 ⑤ 확정: 이 시점에만 황금열쇠를 confirm(확정 차감)한다. 티켓 교환
 * (exchange-ticket) 이후 정해진 시간 안에 이 호출이 오지 않으면 다음 ready 호출
 * 시도(또는 다른 티켓 조작) 시 lazy하게 restore된다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyInternalPlayRequest } from "@/lib/play/internalApiAuth";

export const runtime = "nodejs";

interface ReadyRequestBody {
  ticketToken?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = verifyInternalPlayRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: ReadyRequestBody;
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
  const { data, error } = await service.rpc("mark_play_execution_ticket_ready", {
    p_ticket_token: ticketToken,
  });

  if (error || !data || data.length === 0) {
    console.error("[internal/ready] RPC error:", error);
    return NextResponse.json({ error: "ready_failed" }, { status: 500 });
  }

  const result = data[0] as { success: boolean; reason: string };
  if (!result.success) {
    const status = result.reason === "not_found" || result.reason === "ready_timeout" ? 410 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true });
}
