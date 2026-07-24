/**
 * POST /api/mbti/progress — MBTI 문항 진행 상태 저장 (네이티브 /play/mbti 전용)
 *
 * 인증 구조: 별도 mbti 저장소(commit c6080b3)에서 확정된 playSessionId 기반 세션
 * 검증 패턴을 그대로 재사용한다 — 이 라우트는 Supabase Auth 쿠키(auth.getUser())를
 * 전혀 확인하지 않는다. /play/mbti는 이제 같은 오리진이라 쿠키 인증이 기술적으로는
 * 가능하지만, 대표님 지시(2026-07-25)에 따라 세션 존재/play_type/status/
 * resume_expires_at을 매 요청마다 서버 DB에서 직접 재확인하는 방식을 그대로 유지한다
 * (단순 UUID 신뢰가 아니라 실제 세션 행 상태 검증).
 *
 * k_play_sessions.progress_state는 4종 놀이가 공유하는 애플리케이션 정의 JSONB
 * 컬럼이다. MBTI의 상세 진행 상태(questionIndex/answers/progressVersion/savedAt)는
 * progress_state.mbti 네임스페이스 아래에만 쓴다 — 루트의 progressPercent(범용 놀이
 * 대시보드/자동환불 판단용, app/api/play/progress/route.ts가 다른 놀이 타입에도
 * 동일하게 쓰는 필드)와 충돌하지 않도록 병합 저장한다.
 *
 * 세션 검증(lib/play/sessionAuth)·네임스페이스 조립·버전 CAS 저장
 * (lib/play/progressState)은 놀이 공통 인프라(2026-07-25 리팩터링)로 추출됐다 —
 * 신규 놀이 타입도 이 두 모듈만 재사용하면 동일한 진행 저장 라우트를 만들 수 있다.
 */

import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { loadPlaySession } from "@/lib/play/sessionAuth";
import {
  buildProgressState,
  readNamespace,
  saveProgressWithVersionCas,
} from "@/lib/play/progressState";
import {
  parseMbtiAnswers,
  parseMbtiProgressState,
  type MbtiProgressState,
  type SaveMbtiProgressErrorPayload,
  type SaveMbtiProgressResponse,
} from "@/lib/api/mbtiProgress";

export const runtime = "nodejs";

const PLAY_TYPE = "mbti";
const MBTI_TOTAL_QUESTIONS = 16;

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
    answers === null
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
  const storedVersion = storedProgress?.progressVersion ?? null;

  const nextMbtiState: MbtiProgressState = {
    questionIndex,
    answers,
    progressVersion,
    savedAt: new Date().toISOString(),
  };
  const nextProgressState = buildProgressState(sessionRow.progress_state, PLAY_TYPE, { ...nextMbtiState }, {
    progressPercent: Math.round((answers.length / MBTI_TOTAL_QUESTIONS) * 100),
  });

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
