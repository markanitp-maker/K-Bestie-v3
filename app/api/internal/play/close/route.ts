/**
 * POST /api/internal/play/close — MBTI 등 독립 놀이 서버 전용 API
 *
 * 사용자가 완료 전에 놀이를 닫음(중도 종료). 딥 인터뷰 ⑤ 확정: 이미 confirm된
 * 황금열쇠는 환급하지 않고, 세션은 계속 'in_progress'로 남겨 다음 실행에서
 * 이어하기가 가능하게 한다 — 여기서는 상태 전환 없이 진행상태만 최신화한다.
 */

import type { NextRequest } from "next/server";
import { handleInternalPlayEvent } from "@/lib/play/internalEventHandler";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleInternalPlayEvent(req, "close", async (session, body) => {
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
