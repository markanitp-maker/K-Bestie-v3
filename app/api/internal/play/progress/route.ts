/**
 * POST /api/internal/play/progress — MBTI 등 독립 놀이 서버 전용 API
 *
 * 진행 저장(이어하기용). 공통 세션 봉투(currentStep/totalSteps/payloadVersion/revision)만
 * 플랫폼이 이해하고, opaquePayload(문항 답변 등 MBTI 고유 자료구조)는 해석하지 않고
 * 그대로 저장·반환한다. 헤더 `Idempotency-Key` 필수.
 */

import type { NextRequest } from "next/server";
import { handleInternalPlayEvent, mergeOpaquePayload } from "@/lib/play/internalEventHandler";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleInternalPlayEvent(req, "progress", async (session, body) => {
    const newProgressState = {
      ...session.progressState,
      opaquePayload: mergeOpaquePayload(session.progressState.opaquePayload, body.opaquePayload),
      payloadVersion: body.payloadVersion ?? session.progressState.payloadVersion,
      revision: body.revision ?? session.progressState.revision,
      currentStep: body.currentStep ?? session.progressState.currentStep,
      totalSteps: body.totalSteps ?? session.progressState.totalSteps,
    };

    return {
      newProgressState,
      responseBody: { ok: true, currentStep: newProgressState.currentStep, totalSteps: newProgressState.totalSteps },
    };
  });
}
