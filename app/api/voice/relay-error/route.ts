import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Vertex 릴레이 WebSocket 연결 실패 시 브라우저만 알던 실제 사유(코드/이유)를 서버 로그로도
// 남기기 위한 진단 전용 엔드포인트 — 아이 화면 문구는 바꾸지 않는다(hooks/useGeminiLive.ts의
// handleRelayError가 계속 고정 안내 문구만 보여줌). 여기서는 childId/code/reason만 기록하고
// 음성 원본·transcript·토큰 등은 애초에 받지도 않는다.
export async function POST(req: NextRequest) {
  let body: { childId?: string; code?: number; reason?: string; phase?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  console.error(
    JSON.stringify({
      event: "relay_client_close",
      childId: body.childId ?? null,
      code: body.code ?? null,
      reason: body.reason ?? null,
      phase: body.phase ?? "pre-ready",
      ts: new Date().toISOString(),
    })
  );
  return NextResponse.json({ ok: true });
}
