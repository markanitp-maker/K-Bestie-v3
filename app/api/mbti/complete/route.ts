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
 */

import { NextResponse, after } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { parseMbtiAnswers } from "@/lib/api/mbtiProgress";
import { recordMbtiCompletionEvent } from "@/lib/report/recordMbtiCompletionEvent";
import type {
  CompleteMbtiSessionErrorPayload,
  CompleteMbtiSessionResponse,
} from "@/lib/api/mbtiComplete";
import { ALL_MBTI_TYPES, type MbtiType } from "@/lib/data/mbtiTypes";

export const runtime = "nodejs";

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

  const { data: sessionRow, error: sessionError } = await service
    .from("k_play_sessions")
    .select("id, child_id, status, progress_state, resume_expires_at")
    .eq("id", sessionId)
    .eq("play_type", "mbti")
    .maybeSingle();

  if (sessionError) {
    console.error("[POST /api/mbti/complete] session lookup failed:", sessionError);
    return errorResponse(500, {
      reason: "internal_error",
      message: "완료 처리 중 오류가 발생했습니다.",
    });
  }

  if (!sessionRow) {
    return errorResponse(404, {
      reason: "session_not_found",
      message: "세션을 찾을 수 없습니다.",
    });
  }

  const resumeExpiresAt = sessionRow.resume_expires_at as string | null;
  if (!resumeExpiresAt || new Date(resumeExpiresAt).getTime() <= Date.now()) {
    return errorResponse(409, {
      reason: "session_not_in_progress",
      message: "만료된 세션은 완료 처리할 수 없습니다.",
    });
  }

  if (sessionRow.status !== "in_progress") {
    return errorResponse(409, {
      reason: "session_not_in_progress",
      message: "진행 중인 세션만 완료 처리할 수 있습니다.",
    });
  }

  const existingProgressState =
    typeof sessionRow.progress_state === "object" && sessionRow.progress_state !== null
      ? (sessionRow.progress_state as Record<string, unknown>)
      : {};
  const existingMbtiState =
    typeof existingProgressState.mbti === "object" && existingProgressState.mbti !== null
      ? (existingProgressState.mbti as Record<string, unknown>)
      : {};

  const completedAt = new Date().toISOString();

  const nextProgressState = {
    ...existingProgressState,
    mbti: {
      ...existingMbtiState,
      mbtiType,
      finalAnswers: answers,
      completedAt,
    },
    progressPercent: 100,
  };

  // 조건부(CAS) UPDATE — status='in_progress' 매치 자체가 완료 처리의 compare-and-swap 키다.
  const { data: updatedRows, error: updateError } = await service
    .from("k_play_sessions")
    .update({
      status: "completed",
      completed_at: completedAt,
      progress_state: nextProgressState,
    })
    .eq("id", sessionId)
    .eq("status", "in_progress")
    .select("id");

  if (updateError) {
    console.error("[POST /api/mbti/complete] session completion update failed:", updateError);
    return errorResponse(500, {
      reason: "internal_error",
      message: "완료 처리 중 오류가 발생했습니다.",
    });
  }

  const isWinningCompletion = Boolean(updatedRows && updatedRows.length > 0);
  const response: CompleteMbtiSessionResponse = {
    completed: true,
    reason: isWinningCompletion ? "ok" : "already_completed",
  };

  if (isWinningCompletion) {
    after(() =>
      recordMbtiCompletionEvent({
        childId: sessionRow.child_id as string,
        sessionId,
        mbtiType,
      }).catch((error) => {
        console.error("[POST /api/mbti/complete] recordMbtiCompletionEvent failed:", error);
      }),
    );
  }

  return NextResponse.json(response, { status: 200 });
}
