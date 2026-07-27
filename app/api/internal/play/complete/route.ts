/**
 * POST /api/internal/play/complete — MBTI 등 독립 놀이 서버 전용 API
 *
 * 놀이 완료. k_play_sessions.status를 'completed'로 전환한다. 딥 인터뷰 ⑤: 완료 여부는
 * 황금열쇠 확정 차감(ready 시점에 이미 끝남)과 무관하다 — 여기서는 세션 상태만 갱신한다.
 */

import type { NextRequest } from "next/server";
import { handleInternalPlayEvent } from "@/lib/play/internalEventHandler";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleInternalPlayEvent(req, "complete", async (session, body) => {
    const newProgressState = {
      ...session.progressState,
      opaquePayload: body.opaquePayload ?? session.progressState.opaquePayload,
      payloadVersion: body.payloadVersion ?? session.progressState.payloadVersion,
      revision: body.revision ?? session.progressState.revision,
    };

    return {
      newStatus: "completed",
      newProgressState,
      responseBody: { ok: true },
    };
  });
}
