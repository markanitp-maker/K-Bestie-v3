/**
 * POST /api/mbti/complete — MBTI 세션 완료 처리 (네이티브 /play/mbti 전용)
 * (2026-07-25 200문항뱅크/세션당 20문항 개편)
 *
 * k_play_sessions.status를 in_progress → completed로 CAS 전이하고, progress_state.mbti
 * 네임스페이스에 최종 결과(mbtiType/axisResults/finalAnswers/completedAt)를 병합 저장한다.
 *
 * ── 서버 재검증(신규) ────────────────────────────────────────────────────────
 * 클라이언트가 보낸 answers로부터 서버가 직접 `scoreMbtiAnswers`(결정론적 순수 함수)를
 * 다시 돌려 mbtiType/axisResults를 재계산하고, 클라이언트가 함께 보낸 mbtiType과 대조한다.
 * 불일치하면(클라이언트 버그 또는 변조) 완료 처리를 거부한다 — 이 앱은 놀이 결과 문구를
 * "진단"이 아니라 "이번 놀이에서 나타난 경향"으로 표현하므로, 그 경향 수치(축별 득표) 자체는
 * 반드시 답변에서 그대로 재도출된 값이어야 신뢰할 수 있다.
 *
 * 인증: playSessionId 기반 세션 조회 검증(c6080b3 패턴)만 쓴다 — Supabase Auth 쿠키를
 * 확인하지 않는다.
 */

import { NextResponse, after } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { loadPlaySession } from "@/lib/play/sessionAuth";
import { buildProgressState, readNamespace } from "@/lib/play/progressState";
import { completeInProgressSession } from "@/lib/play/completion";
import { parseMbtiAnswers, parseMbtiProgressState } from "@/lib/api/mbtiProgress";
import { scoreMbtiAnswers } from "@/lib/mbti/scoreResult";
import { recordMbtiCompletionEvent } from "@/lib/report/recordMbtiCompletionEvent";
import type {
  CompleteMbtiSessionErrorPayload,
  CompleteMbtiSessionResponse,
} from "@/lib/api/mbtiComplete";
import { ALL_MBTI_TYPES, type MbtiType } from "@/lib/data/mbtiTypes";

export const runtime = "nodejs";

const PLAY_TYPE = "mbti";
const MBTI_TOTAL_QUESTIONS = 20;

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
  const claimedMbtiType = body.mbtiType;
  const answers = parseMbtiAnswers(body.answers);

  if (!sessionId || !isMbtiType(claimedMbtiType) || answers === null || answers.length !== MBTI_TOTAL_QUESTIONS) {
    return errorResponse(400, {
      reason: "invalid_input",
      message: "sessionId/mbtiType/answers 값이 올바르지 않습니다.",
    });
  }

  let scoreResult: ReturnType<typeof scoreMbtiAnswers>;
  try {
    scoreResult = scoreMbtiAnswers(answers);
  } catch (error) {
    console.error("[POST /api/mbti/complete] server-side re-scoring failed:", error);
    return errorResponse(400, {
      reason: "invalid_input",
      message: "제출한 답변으로 결과를 계산할 수 없습니다.",
    });
  }

  if (scoreResult.mbtiType !== claimedMbtiType) {
    console.error(
      `[POST /api/mbti/complete] mbtiType mismatch: client="${claimedMbtiType}" server="${scoreResult.mbtiType}"`,
    );
    return errorResponse(400, {
      reason: "score_mismatch",
      message: "제출한 결과가 답변으로 계산한 결과와 일치하지 않습니다.",
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
  const existingMbtiState = parseMbtiProgressState(readNamespace(sessionRow.progress_state, PLAY_TYPE));

  if (!existingMbtiState) {
    return errorResponse(409, {
      reason: "session_not_initialized",
      message: "문항이 아직 선정되지 않은 세션입니다.",
    });
  }

  // 제출된 답변의 문항 ID 집합이 이 세션에 고정 저장된 questionOrder와 정확히 일치하는지
  // 확인한다 — 다른 세션/문항 조합의 답변이 섞여 들어오는 것을 막는다.
  const answeredIds = new Set(answers.map((a) => a.questionId));
  const expectedIds = new Set(existingMbtiState.questionOrder);
  const idsMatch =
    answeredIds.size === expectedIds.size &&
    [...answeredIds].every((id) => expectedIds.has(id));
  if (!idsMatch) {
    return errorResponse(400, {
      reason: "question_set_mismatch",
      message: "제출한 답변의 문항 구성이 이 세션에 고정된 문항과 일치하지 않습니다.",
    });
  }

  const completedAt = new Date().toISOString();

  const nextProgressState = buildProgressState(
    sessionRow.progress_state,
    PLAY_TYPE,
    {
      ...existingMbtiState,
      answers,
      questionIndex: MBTI_TOTAL_QUESTIONS,
      mbtiType: scoreResult.mbtiType,
      axisResults: scoreResult.axisResults,
      completedAt,
    },
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
        mbtiType: scoreResult.mbtiType,
      }).catch((err) => {
        console.error("[POST /api/mbti/complete] recordMbtiCompletionEvent failed:", err);
      }),
    );
  }

  return NextResponse.json(response, { status: 200 });
}
