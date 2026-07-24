/**
 * GET /api/mbti/session — 이어하기 진행 상태 재수화(rehydration) 조회 (네이티브 /play/mbti 전용)
 *
 * 세션 생성·황금열쇠 차감은 전적으로 /api/play/consume(메인 앱 공용 놀이 인프라)의
 * 책임이다. 이 라우트는 그 세션의 sessionId를 받아 저장된 progress_state.mbti만
 * 재수화한다. 인증은 playSessionId+childId 소유권 확인 방식(c6080b3 패턴)을 그대로
 * 쓴다 — Supabase Auth 쿠키를 확인하지 않는다.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { parseMbtiProgressState } from "@/lib/api/mbtiProgress";
import type {
  FetchMbtiSessionProgressErrorPayload,
  FetchMbtiSessionProgressResponse,
} from "@/lib/api/fetchMbtiSessionProgress";

export const runtime = "nodejs";

function errorResponse(
  status: number,
  payload: FetchMbtiSessionProgressErrorPayload,
): NextResponse {
  return NextResponse.json(payload, { status });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() ?? "";
  const childId = request.nextUrl.searchParams.get("childId")?.trim() ?? "";

  if (!sessionId || !childId) {
    return errorResponse(400, {
      reason: "invalid_input",
      message: "sessionId와 childId가 모두 필요합니다.",
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
    console.error("[GET /api/mbti/session] session lookup failed:", sessionError);
    return errorResponse(500, {
      reason: "internal_error",
      message: "세션 조회 중 오류가 발생했습니다.",
    });
  }

  if (!sessionRow) {
    return errorResponse(404, {
      reason: "session_not_found",
      message: "세션을 찾을 수 없습니다.",
    });
  }

  if (sessionRow.child_id !== childId) {
    return errorResponse(403, {
      reason: "forbidden",
      message: "이 세션은 요청한 아이의 세션이 아닙니다.",
    });
  }

  const resumeExpiresAt = sessionRow.resume_expires_at as string | null;
  if (!resumeExpiresAt || new Date(resumeExpiresAt).getTime() <= Date.now()) {
    return errorResponse(404, {
      reason: "session_not_in_progress",
      message: "만료된 세션입니다.",
    });
  }

  if (sessionRow.status !== "in_progress") {
    return errorResponse(404, {
      reason: "session_not_in_progress",
      message: "진행 중인 세션이 아닙니다.",
    });
  }

  const existingProgressState =
    typeof sessionRow.progress_state === "object" && sessionRow.progress_state !== null
      ? (sessionRow.progress_state as Record<string, unknown>)
      : {};

  const body: FetchMbtiSessionProgressResponse = {
    progressState: parseMbtiProgressState(existingProgressState.mbti),
  };
  return NextResponse.json(body, { status: 200 });
}
