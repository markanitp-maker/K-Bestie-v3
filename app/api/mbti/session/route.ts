/**
 * GET /api/mbti/session — 이어하기 진행 상태 재수화 + 최초 진입 시 20문항 선정
 * (네이티브 /play/mbti 전용, 2026-07-25 200문항뱅크 개편)
 *
 * 세션 생성·황금열쇠 차감은 전적으로 /api/play/consume(메인 앱 공용 놀이 인프라)의
 * 책임이다. 이 라우트는 그 세션의 sessionId를 받아 저장된 progress_state.mbti를
 * 재수화한다. 인증은 playSessionId+childId 소유권 확인 방식(c6080b3 패턴)을 그대로
 * 쓴다 — Supabase Auth 쿠키를 확인하지 않는다.
 *
 * ── 신규: 최초 진입 시 20문항 즉시 선정·고정 ────────────────────────────────────
 * 기존에는 문항 선정이 클라이언트에서 정적 배열을 그대로 쓰는 방식이라 서버 개입이
 * 필요 없었지만, 200문항뱅크 개편으로 "축당 5문항 균형 무작위 + 최근 3세션 재출제
 * 회피"가 요구되면서 선정 자체가 서버(DB 조회 필요)의 책임이 됐다. 저장된 진행이
 * 없으면(v2 shape 파싱 실패 — 최초 진입이거나 구버전 데이터) 이 호출 안에서:
 *   1. 같은 아이의 최근 완료 MBTI 세션 최대 3개(최신순)에서 questionOrder를 모아
 *      재출제 회피 후보로 사용
 *   2. `selectMbtiQuestions`로 20문항 선정 + 좌우 옵션 순서 고정
 *   3. `progress_state.mbti`가 아직 비어 있을 때만(CAS) 이 선정 결과를 저장 — 동시
 *      요청 경합 시 먼저 쓴 요청의 결과를 그대로 재조회해 반환한다(중복 선정 방지)
 * 이렇게 확정된 questionOrder/optionOrder는 이후 새로고침·이어하기에서 절대 다시
 * 계산되지 않는다 — 이 함수는 "아직 없을 때 한 번" 초기화만 담당한다.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { loadPlaySession } from "@/lib/play/sessionAuth";
import { readNamespace, buildProgressState } from "@/lib/play/progressState";
import { parseMbtiProgressState, type MbtiProgressState } from "@/lib/api/mbtiProgress";
import { selectMbtiQuestions } from "@/lib/mbti/selectQuestions";
import type {
  FetchMbtiSessionProgressErrorPayload,
  FetchMbtiSessionProgressResponse,
} from "@/lib/api/fetchMbtiSessionProgress";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const PLAY_TYPE = "mbti";
const RECENT_SESSIONS_LIMIT = 3;

function errorResponse(
  status: number,
  payload: FetchMbtiSessionProgressErrorPayload,
): NextResponse {
  return NextResponse.json(payload, { status });
}

/** 같은 아이의 최근 완료 MBTI 세션(최대 3개, 최신순)에서 questionOrder만 모은다.
 * 구버전(v1) 완료 세션은 parseMbtiProgressState가 null을 반환하므로 자연스럽게
 * 빈 배열로 취급된다(재출제 회피 후보 계산에서 조용히 제외 — 크래시 없이 안전 열화). */
async function fetchRecentSessionsQuestionIds(
  service: SupabaseClient,
  childId: string,
): Promise<readonly (readonly string[])[]> {
  const { data, error } = await service
    .from("k_play_sessions")
    .select("progress_state")
    .eq("child_id", childId)
    .eq("play_type", PLAY_TYPE)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(RECENT_SESSIONS_LIMIT);

  if (error || !data) {
    console.error("[GET /api/mbti/session] recent sessions lookup failed:", error);
    return [];
  }

  return data.map((row) => {
    const parsed = parseMbtiProgressState(readNamespace(row.progress_state, PLAY_TYPE));
    return parsed?.questionOrder ?? [];
  });
}

/** progress_state.mbti가 아직 비어 있을 때만(CAS) 새로 선정한 20문항을 저장한다.
 * 경합에서 졌으면(0행 매치) 그 사이 다른 요청이 먼저 쓴 값을 재조회해 반환한다. */
async function initializeSelectionIfEmpty(
  service: SupabaseClient,
  sessionId: string,
  currentProgressStateRaw: unknown,
  childId: string,
): Promise<MbtiProgressState> {
  const recentSessionsQuestionIds = await fetchRecentSessionsQuestionIds(service, childId);
  const selection = selectMbtiQuestions({ recentSessionsQuestionIds });

  const initialState: MbtiProgressState = {
    schemaVersion: 2,
    questionOrder: selection.questionOrder,
    selectedQuestionIds: selection.selectedQuestionIds,
    optionOrder: selection.optionOrder,
    questionIndex: 0,
    answers: [],
    progressVersion: 0,
    savedAt: new Date().toISOString(),
  };

  const nextProgressState = buildProgressState(currentProgressStateRaw, PLAY_TYPE, { ...initialState });

  // CAS 조건: "이 함수를 호출하기 직전에 실제로 읽은 progress_state와 지금도 정확히 같을 때만"
  // 갱신한다(전체 JSONB 값에 대한 낙관적 잠금). `.is(namespace, null)`처럼 mbti 네임스페이스가
  // "SQL NULL"인지만 보는 조건은 구버전(스키마 개편 전, schemaVersion 없는 16문항 shape)
  // 데이터가 이미 들어있는 세션에서는 절대 매치되지 않는다 — 값이 null이 아니라 "파싱은
  // 실패하지만 존재는 하는" 구버전 객체이기 때문이다. 그 경우 이 UPDATE가 0행에 매치되어
  // "경합에서 짐"으로 오판하고, 재조회해도 여전히 같은 구버전 데이터라 파싱에 또 실패해
  // 무한히 500을 반환하는 버그가 있었다(독립 코드 리뷰로 발견). 전체 값을 그대로
  // 낙관적 잠금 키로 쓰면 "비어 있던 세션"과 "구버전 데이터가 있던 세션" 모두 동일하게
  // 안전히 처리된다 — 둘 다 GET 상위 로직이 이미 parseMbtiProgressState로 "유효한 v2 진행
  // 없음"을 판정했을 때만 이 함수가 호출되기 때문이다.
  const { data: updatedRows, error: updateError } = await service
    .from("k_play_sessions")
    .update({ progress_state: nextProgressState })
    .eq("id", sessionId)
    .eq("status", "in_progress")
    // jsonb 컬럼에 대한 eq 필터는 PostgREST가 JSON 텍스트로 파싱하므로 반드시
    // JSON.stringify로 직렬화해서 넘겨야 한다(원시 JS 객체를 그대로 넘기면 "[object
    // Object]"로 문자열화되어 "invalid input syntax for type json" 오류가 난다 —
    // 로컬 재현으로 확인).
    .eq("progress_state", JSON.stringify(currentProgressStateRaw))
    .select("id");

  if (updateError) {
    throw updateError;
  }

  if (updatedRows && updatedRows.length > 0) {
    return initialState;
  }

  // 경합에서 짐 — 다른 요청이 먼저 초기화했다. 그 결과를 그대로 재조회해서 반환한다.
  const { data: refetched, error: refetchError } = await service
    .from("k_play_sessions")
    .select("progress_state")
    .eq("id", sessionId)
    .maybeSingle();

  if (refetchError || !refetched) {
    throw refetchError ?? new Error("세션 재조회에 실패했습니다.");
  }

  const parsed = parseMbtiProgressState(readNamespace(refetched.progress_state, PLAY_TYPE));
  if (!parsed) {
    throw new Error("동시 초기화 경합 후 진행 상태 재조회 결과가 유효하지 않습니다.");
  }
  return parsed;
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

  const existing = parseMbtiProgressState(readNamespace(sessionRow.progress_state, PLAY_TYPE));
  if (existing) {
    const body: FetchMbtiSessionProgressResponse = { progressState: existing };
    return NextResponse.json(body, { status: 200 });
  }

  try {
    const initialized = await initializeSelectionIfEmpty(
      service,
      sessionId,
      sessionRow.progress_state,
      sessionRow.child_id,
    );
    const body: FetchMbtiSessionProgressResponse = { progressState: initialized };
    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    console.error("[GET /api/mbti/session] question selection initialization failed:", error);
    return errorResponse(500, {
      reason: "internal_error",
      message: "문항 선정 중 오류가 발생했습니다.",
    });
  }
}
