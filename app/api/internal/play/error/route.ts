/**
 * POST /api/internal/play/error — MBTI 등 독립 놀이 서버 전용 API
 *
 * 놀이 진행 중(ready 이후) 독립 놀이 서버가 겪은 오류 보고. 세션 상태는 바꾸지
 * 않는다(이미 confirm된 황금열쇠는 환급 대상 아님, 딥 인터뷰 ⑤) — 진단 목적으로
 * 서버 로그에만 남기고 진행상태는 최신화한다.
 */

import type { NextRequest } from "next/server";
import { handleInternalPlayEvent } from "@/lib/play/internalEventHandler";

export const runtime = "nodejs";

interface ErrorEventBody {
  errorCode?: string;
  errorMessage?: string;
  diagnostics?: unknown;
}

export async function POST(req: NextRequest) {
  return handleInternalPlayEvent(req, "error", async (session, body) => {
    const errorBody = body as ErrorEventBody;
    console.error("[internal/play/error] 독립 놀이 서버 오류 보고:", {
      playSessionId: session.id,
      errorCode: errorBody.errorCode,
      errorMessage: errorBody.errorMessage,
      diagnostics: errorBody.diagnostics,
    });

    const newProgressState = {
      ...session.progressState,
      opaquePayload: body.opaquePayload ?? session.progressState.opaquePayload,
      payloadVersion: body.payloadVersion ?? session.progressState.payloadVersion,
      revision: body.revision ?? session.progressState.revision,
    };

    return {
      newProgressState,
      responseBody: { ok: true },
    };
  });
}
