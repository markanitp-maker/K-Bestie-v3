/**
 * GET /api/mbti/session — 이어하기 진행 상태 재수화(rehydration) 조회 (네이티브 /play/mbti 전용)
 *
 * 세션 생성·황금열쇠 차감은 전적으로 /api/play/consume(메인 앱 공용 놀이 인프라)의
 * 책임이다. 이 라우트는 그 세션의 sessionId를 받아 저장된 progress_state.mbti만
 * 재수화한다. 인증은 playSessionId+childId 소유권 확인 방식(c6080b3 패턴)을 그대로
 * 쓴다 — Supabase Auth 쿠키를 확인하지 않는다.
 *
 * 세션 검증은 lib/play/sessionAuth의 공용 헬퍼를 쓴다(2026-07-25 리팩터링) — 다만
 * 실패 사유별 HTTP 상태 코드·메시지는 이 라우트 고유 계약(전부 404 계열)을 그대로
 * 유지한다(progress/complete 라우트의 409 계열과 의도적으로 다름).
 */

import { NextResponse, type NextRequest } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { loadPlaySession } from "@/lib/play/sessionAuth";
import { readNamespace } from "@/lib/play/progressState";
import { parseMbtiProgressState } from "@/lib/api/mbtiProgress";
import type {
  FetchMbtiSessionProgressErrorPayload,
  FetchMbtiSessionProgressResponse,
} from "@/lib/api/fetchMbtiSessionProgress";

export const runtime = "nodejs";

const PLAY_TYPE = "mbti";

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

  const validity = await loadPlaySession(service, sessionId, PLAY_TYPE, childId);
  if (!validity.valid) {
    switch (validity.reason) {
      case "lookup_error":
        return errorResponse(500, {
          reason: "internal_error",
          message: "세션 조회 중 오류가 발생했습니다.",
        });
      case "not_found":
        return errorResponse(404, {
          reason: "session_not_found",
          message: "세션을 찾을 수 없습니다.",
        });
      case "forbidden":
        return errorResponse(403, {
          reason: "forbidden",
          message: "이 세션은 요청한 아이의 세션이 아닙니다.",
        });
      case "expired":
        return errorResponse(404, {
          reason: "session_not_in_progress",
          message: "만료된 세션입니다.",
        });
      case "not_in_progress":
        return errorResponse(404, {
          reason: "session_not_in_progress",
          message: "진행 중인 세션이 아닙니다.",
        });
    }
  }

  const sessionRow = validity.session;

  const body: FetchMbtiSessionProgressResponse = {
    progressState: parseMbtiProgressState(readNamespace(sessionRow.progress_state, PLAY_TYPE)),
  };
  return NextResponse.json(body, { status: 200 });
}
