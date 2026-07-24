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
 */

import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import {
  parseMbtiAnswers,
  parseMbtiProgressState,
  type MbtiProgressState,
  type SaveMbtiProgressErrorPayload,
  type SaveMbtiProgressResponse,
} from "@/lib/api/mbtiProgress";

export const runtime = "nodejs";

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

  const { data: sessionRow, error: sessionError } = await service
    .from("k_play_sessions")
    .select("id, child_id, status, progress_state, resume_expires_at")
    .eq("id", sessionId)
    .eq("play_type", "mbti")
    .maybeSingle();

  if (sessionError) {
    console.error("[POST /api/mbti/progress] session lookup failed:", sessionError);
    return errorResponse(500, {
      reason: "internal_error",
      message: "진행 저장 처리 중 오류가 발생했습니다.",
    });
  }

  if (!sessionRow) {
    return errorResponse(404, {
      reason: "session_not_found",
      message: "세션을 찾을 수 없습니다.",
    });
  }

  // 6시간 이어하기 창(resume_expires_at) 경과 시 진행 저장 대상이 아니다.
  const resumeExpiresAt = sessionRow.resume_expires_at as string | null;
  if (!resumeExpiresAt || new Date(resumeExpiresAt).getTime() <= Date.now()) {
    return errorResponse(409, {
      reason: "session_not_in_progress",
      message: "만료된 세션에는 진행 상태를 저장할 수 없습니다.",
    });
  }

  if (sessionRow.status !== "in_progress") {
    return errorResponse(409, {
      reason: "session_not_in_progress",
      message: "이미 종료된 세션에는 진행 상태를 저장할 수 없습니다.",
    });
  }

  const existingProgressState =
    typeof sessionRow.progress_state === "object" && sessionRow.progress_state !== null
      ? (sessionRow.progress_state as Record<string, unknown>)
      : {};

  const storedProgress = parseMbtiProgressState(existingProgressState.mbti);
  const storedVersion = storedProgress?.progressVersion ?? 0;

  // 버전 가드 — 오래된(더 작거나 같은) 버전의 요청은 최신 진행 상태를 절대 덮어쓰지 못한다.
  if (progressVersion <= storedVersion) {
    const response: SaveMbtiProgressResponse = {
      applied: false,
      reason: "stale_progress_version",
    };
    return NextResponse.json(response, { status: 200 });
  }

  const nextMbtiState: MbtiProgressState = {
    questionIndex,
    answers,
    progressVersion,
    savedAt: new Date().toISOString(),
  };

  const nextProgressState = {
    ...existingProgressState,
    mbti: nextMbtiState,
    progressPercent: Math.round((answers.length / MBTI_TOTAL_QUESTIONS) * 100),
  };

  // 조건부(CAS) UPDATE — 조회와 쓰기 사이 경쟁을 막기 위해 이전 상태 일치 조건을 WHERE에 건다.
  let updateQuery = service
    .from("k_play_sessions")
    .update({ progress_state: nextProgressState })
    .eq("id", sessionId)
    .eq("status", "in_progress");

  updateQuery =
    storedProgress === null
      ? updateQuery.is("progress_state->mbti", null)
      : updateQuery.eq("progress_state->mbti->>progressVersion", String(storedVersion));

  const { data: updatedRows, error: updateError } = await updateQuery.select("id");

  if (updateError) {
    console.error("[POST /api/mbti/progress] progress update failed:", updateError);
    return errorResponse(500, {
      reason: "internal_error",
      message: "진행 저장 처리 중 오류가 발생했습니다.",
    });
  }

  if (!updatedRows || updatedRows.length === 0) {
    const response: SaveMbtiProgressResponse = {
      applied: false,
      reason: "progress_version_conflict",
    };
    return NextResponse.json(response, { status: 200 });
  }

  const response: SaveMbtiProgressResponse = { applied: true, reason: "ok" };
  return NextResponse.json(response, { status: 200 });
}
