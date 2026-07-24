/**
 * POST /api/mbti/complete — MBTI 세션 완료 처리 (네이티브 /play/mbti 전용)
 *
 * 완료 이벤트(구 postMessage MBTI_COMPLETED가 하던 일)를 이 라우트가 직접 수행한다:
 * k_play_sessions.status를 in_progress → completed로 CAS 전이하고, progress_state.mbti
 * 네임스페이스에 최종 결과(mbtiType/finalAnswers/completedAt)를 병합 저장한 뒤, 이 요청이
 * 그 전이를 실제로 이끌어낸 "승자"일 때만 recordMbtiCompletionEvent()로 부모 리포트
 * 파이프라인용 이벤트를 논블로킹 기록한다.
 *
 * 인증: playSessionId 기반 세션 조회 검증(c6080b3 패턴)만 쓴다 — Supabase Auth 쿠키를
 * 확인하지 않는다. app/api/play/callback/complete/route.ts(기존 iframe 공용 콜백)와 달리
 * progress_state를 통째로 덮어쓰지 않고 mbti 네임스페이스만 병합한다.
 *
 * 세션 검증(lib/play/sessionAuth)·네임스페이스 병합(lib/play/progressState)·CAS 완료
 * 전이(lib/play/completion)는 놀이 공통 인프라(2026-07-25 리팩터링)로 추출됐다 — 완료
 * 후 부모 리포트 이벤트 기록(recordMbtiCompletionEvent)은 현재 MBTI만 구현돼 있는
 * 게임별 후속 처리라 공통 모듈에 넣지 않고 이 라우트에 그대로 둔다.
 */

import { NextResponse, after } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { loadPlaySession } from "@/lib/play/sessionAuth";
import { buildProgressState, readNamespace } from "@/lib/play/progressState";
import { completeInProgressSession } from "@/lib/play/completion";
import { parseMbtiAnswers } from "@/lib/api/mbtiProgress";
import { recordMbtiCompletionEvent } from "@/lib/report/recordMbtiCompletionEvent";
import type {
  CompleteMbtiSessionErrorPayload,
  CompleteMbtiSessionResponse,
} from "@/lib/api/mbtiComplete";
import { ALL_MBTI_TYPES, type MbtiType } from "@/lib/data/mbtiTypes";

export const runtime = "nodejs";

const PLAY_TYPE = "mbti";

interface RawCompleteSessionRequestBody {
  sessionId?: unknown;
  mbtiType?: unknown;
  answers?: unknown;
}

function isMbtiType(value: unknown): value is MbtiType {
  return typeof value === "string" && (ALL_MBTI_TYPES as readonly string[]).includes(value);
}

function errorResponse(status: number, payload: CompleteMbtiSessionErrorPayload): NextResponse {
  return NextResponse.json(payload, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: RawCompleteSessionRequestBody;
  try {
    body = (await request.json()) as RawCompleteSessionRequestBody;
  } catch {
    return errorResponse(400, {
      reason: "invalid_input",
      message: "요청 본문이 올바른 JSON이 아닙니다.",
    });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const mbtiType = body.mbtiType;
  const answers = parseMbtiAnswers(body.answers);

  if (!sessionId || !isMbtiType(mbtiType) || answers === null) {
    return errorResponse(400, {
      reason: "invalid_input",
      message: "sessionId/mbtiType/answers 값이 올바르지 않습니다.",
    });
  }

  const service = createServiceClient();

  const validity = await loadPlaySession(service, sessionId, PLAY_TYPE);
  if (!validity.valid) {
    switch (validity.reason) {
      case "lookup_error":
        return errorResponse(500, {
          reason: "internal_error",
          message: "완료 처리 중 오류가 발생했습니다.",
        });
      case "not_found":
        return errorResponse(404, {
          reason: "session_not_found",
          message: "세션을 찾을 수 없습니다.",
        });
      case "expired":
        return errorResponse(409, {
          reason: "session_not_in_progress",
          message: "만료된 세션은 완료 처리할 수 없습니다.",
        });
      case "not_in_progress":
        return errorResponse(409, {
          reason: "session_not_in_progress",
          message: "진행 중인 세션만 완료 처리할 수 있습니다.",
        });
      case "forbidden":
        // 이 라우트는 expectedChildId를 넘기지 않으므로 이론상 도달하지 않는다(방어적 처리).
        return errorResponse(500, {
          reason: "internal_error",
          message: "완료 처리 중 오류가 발생했습니다.",
        });
    }
  }

  const sessionRow = validity.session;
  const existingMbtiState = readNamespace(sessionRow.progress_state, PLAY_TYPE);
  const completedAt = new Date().toISOString();

  const nextProgressState = buildProgressState(
    sessionRow.progress_state,
    PLAY_TYPE,
    { ...existingMbtiState, mbtiType, finalAnswers: answers, completedAt },
    { progressPercent: 100 },
  );

  const { isWinner, error } = await completeInProgressSession(
    service,
    sessionId,
    nextProgressState,
    completedAt,
  );

  if (error) {
    console.error("[POST /api/mbti/complete] session completion update failed:", error);
    return errorResponse(500, {
      reason: "internal_error",
      message: "완료 처리 중 오류가 발생했습니다.",
    });
  }

  const response: CompleteMbtiSessionResponse = {
    completed: true,
    reason: isWinner ? "ok" : "already_completed",
  };

  if (isWinner) {
    after(() =>
      recordMbtiCompletionEvent({
        childId: sessionRow.child_id,
        sessionId,
        mbtiType,
      }).catch((err) => {
        console.error("[POST /api/mbti/complete] recordMbtiCompletionEvent failed:", err);
      }),
    );
  }

  return NextResponse.json(response, { status: 200 });
}
