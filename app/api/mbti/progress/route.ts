/**
 * POST /api/mbti/progress — MBTI 문항 진행 상태 저장 (네이티브 /play/mbti 전용)
 * (2026-07-25 200문항뱅크/세션당 20문항 개편, schemaVersion 2)
 *
 * 인증 구조: 별도 mbti 저장소(commit c6080b3)에서 확정된 playSessionId 기반 세션
 * 검증 패턴을 그대로 재사용한다 — 이 라우트는 Supabase Auth 쿠키를 확인하지 않는다.
 *
 * 이 라우트는 questionOrder/optionOrder/selectedQuestionIds를 절대 재계산하지 않는다
 * (그건 `GET /api/mbti/session`이 최초 진입 시 단 한 번만 고정한다). 여기서는 기존에
 * 저장된 그 값들을 그대로 보존한 채 questionIndex/answers/progressVersion만 갱신한다.
 * 아직 초기화(GET 최초 호출)가 되지 않은 세션에 저장을 시도하면(이론상 클라이언트가
 * GET을 건너뛰지 않는 한 발생하지 않음) 명확한 오류로 거부한다 — questionOrder 없이
 * progress_state를 저장하면 이후 조회에서 파싱 실패(구버전 취급)로 조용히 무시되는
 * 데이터 손상을 막기 위한 방어선이다.
 */

import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { loadPlaySession } from "@/lib/play/sessionAuth";
import { buildProgressState, readNamespace, saveProgressWithVersionCas } from "@/lib/play/progressState";
import {
  parseMbtiAnswers,
  parseMbtiProgressState,
  type MbtiProgressState,
  type SaveMbtiProgressErrorPayload,
  type SaveMbtiProgressResponse,
} from "@/lib/api/mbtiProgress";

export const runtime = "nodejs";

const PLAY_TYPE = "mbti";
const MBTI_TOTAL_QUESTIONS = 20;

interface RawSaveProgressRequestBody {
  sessionId?: unknown;
  questionIndex?: unknown;
  answers?: unknown;
  progressVersion?: unknown;
}

function errorResponse(status: number, payload: SaveMbtiProgressErrorPayload): NextResponse {
  return NextResponse.json(payload, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: RawSaveProgressRequestBody;
  try {
    body = (await request.json()) as RawSaveProgressRequestBody;
  } catch {
    return errorResponse(400, {
      reason: "invalid_input",
      message: "요청 본문이 올바른 JSON이 아닙니다.",
    });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const questionIndex = typeof body.questionIndex === "number" ? body.questionIndex : NaN;
  const progressVersion = typeof body.progressVersion === "number" ? body.progressVersion : NaN;
  const answers = parseMbtiAnswers(body.answers);

  if (
    !sessionId ||
    !Number.isFinite(questionIndex) ||
    !Number.isFinite(progressVersion) ||
    answers === null ||
    answers.length > MBTI_TOTAL_QUESTIONS
  ) {
    return errorResponse(400, {
      reason: "invalid_input",
      message: "sessionId/questionIndex/answers/progressVersion 값이 올바르지 않습니다.",
    });
  }

  const service = createServiceClient();

  const validity = await loadPlaySession(service, sessionId, PLAY_TYPE);
  if (!validity.valid) {
    switch (validity.reason) {
      case "lookup_error":
        return errorResponse(500, {
          reason: "internal_error",
          message: "진행 저장 처리 중 오류가 발생했습니다.",
        });
      case "not_found":
        return errorResponse(404, {
          reason: "session_not_found",
          message: "세션을 찾을 수 없습니다.",
        });
      case "expired":
        return errorResponse(409, {
          reason: "session_not_in_progress",
          message: "만료된 세션에는 진행 상태를 저장할 수 없습니다.",
        });
      case "not_in_progress":
        return errorResponse(409, {
          reason: "session_not_in_progress",
          message: "이미 종료된 세션에는 진행 상태를 저장할 수 없습니다.",
        });
      case "forbidden":
        // 이 라우트는 expectedChildId를 넘기지 않으므로 이론상 도달하지 않는다(방어적 처리).
        return errorResponse(500, {
          reason: "internal_error",
          message: "진행 저장 처리 중 오류가 발생했습니다.",
        });
    }
  }

  const sessionRow = validity.session;
  const storedProgress = parseMbtiProgressState(readNamespace(sessionRow.progress_state, PLAY_TYPE));

  if (!storedProgress) {
    // GET /api/mbti/session이 먼저 20문항을 선정·고정해야만 이 라우트가 안전하게 병합 저장할
    // 수 있다 — questionOrder 없이 저장하면 다음 조회에서 구버전으로 오인되어 진행이 사라진다.
    return errorResponse(409, {
      reason: "session_not_initialized",
      message: "문항이 아직 선정되지 않은 세션입니다. 세션 조회를 먼저 호출해야 합니다.",
    });
  }

  const storedVersion = storedProgress.progressVersion;

  const nextMbtiState: MbtiProgressState = {
    ...storedProgress,
    questionIndex,
    answers,
    progressVersion,
    savedAt: new Date().toISOString(),
  };
  const nextProgressState = buildProgressState(sessionRow.progress_state, PLAY_TYPE, { ...nextMbtiState });

  const result = await saveProgressWithVersionCas(
    service,
    sessionId,
    PLAY_TYPE,
    storedVersion,
    progressVersion,
    nextProgressState,
  );

  if (!result.applied) {
    if (result.reason === "internal_error") {
      console.error("[POST /api/mbti/progress] progress update failed:", result.error);
      return errorResponse(500, {
        reason: "internal_error",
        message: "진행 저장 처리 중 오류가 발생했습니다.",
      });
    }
    const response: SaveMbtiProgressResponse = { applied: false, reason: result.reason };
    return NextResponse.json(response, { status: 200 });
  }

  const response: SaveMbtiProgressResponse = { applied: true, reason: "ok" };
  return NextResponse.json(response, { status: 200 });
}
