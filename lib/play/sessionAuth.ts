/**
 * 케이 놀이 공통 인프라 — playSessionId 기반 세션 검증 (쿠키 인증 아님)
 *
 * MBTI 네이티브 통합(2026-07-25, c6080b3 패턴 이식)에서 확정된 방식을 모든 놀이
 * 타입이 재사용할 수 있도록 추출했다. 세션 생성·황금열쇠 차감·소유권 인증은
 * 전적으로 /api/play/consume(쿠키 인증 + requireChildAccess)이 이미 수행했으므로,
 * 그 뒤 실제 놀이 화면(/play/<type>)의 진행 저장·이어하기 조회·완료 처리 API는
 * playSessionId 자체를 capability token으로 취급해 k_play_sessions을 매 요청마다
 * 직접 조회 검증한다 — Supabase Auth 쿠키를 다시 확인하지 않는다.
 *
 * 이 함수는 상태를 "not_found/expired/not_in_progress" 같은 중립적인 사유로만
 * 분류하고, 실제 HTTP 상태 코드·에러 메시지는 호출부(각 게임의 API 라우트)가
 * 결정한다 — GET류 조회 라우트와 POST류 쓰기 라우트가 같은 실패 상황에도 서로
 * 다른 상태 코드(404 vs 409)와 문구를 쓰는 기존 MBTI 라우트의 계약을 그대로
 * 보존하기 위함이다(신규 게임을 붙일 때도 이 재량은 그대로 유지된다).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PlaySessionRow {
  id: string;
  child_id: string;
  status: string;
  progress_state: unknown;
  resume_expires_at: string | null;
}

export type PlaySessionValidity =
  | { valid: true; session: PlaySessionRow }
  | { valid: false; reason: "lookup_error" | "not_found" | "forbidden" | "expired" | "not_in_progress" };

/**
 * k_play_sessions에서 `id`+`play_type`으로 세션을 조회하고, 6시간 이어하기 창
 * (resume_expires_at)이 지나지 않았는지·상태가 `in_progress`인지 확인한다.
 *
 * `expectedChildId`를 넘기면 소유권(child_id) 검증을 만료/상태 검사보다 먼저 수행한다
 * (GET /api/mbti/session의 원래 계약 순서 — 세션이 존재하지만 다른 아이 것이면, 그
 * 세션이 마침 만료됐더라도 403 forbidden을 우선한다). 넘기지 않으면 소유권 검증을
 * 생략한다 — progress/complete류 쓰기 라우트는 sessionId 자체를 이미 인증된 요청에서만
 * 발급되는 토큰으로 신뢰하는 것이 MBTI의 원래 설계다(2026-07-25 claude-review 검증 시
 * 대표님 지시로 유지 확정).
 */
export async function loadPlaySession(
  service: SupabaseClient,
  sessionId: string,
  playType: string,
  expectedChildId?: string,
): Promise<PlaySessionValidity> {
  const { data: sessionRow, error } = await service
    .from("k_play_sessions")
    .select("id, child_id, status, progress_state, resume_expires_at")
    .eq("id", sessionId)
    .eq("play_type", playType)
    .maybeSingle();

  if (error) {
    console.error(`[loadPlaySession:${playType}] session lookup failed:`, error);
    return { valid: false, reason: "lookup_error" };
  }
  if (!sessionRow) {
    return { valid: false, reason: "not_found" };
  }

  if (expectedChildId !== undefined && sessionRow.child_id !== expectedChildId) {
    return { valid: false, reason: "forbidden" };
  }

  const resumeExpiresAt = sessionRow.resume_expires_at as string | null;
  if (!resumeExpiresAt || new Date(resumeExpiresAt).getTime() <= Date.now()) {
    return { valid: false, reason: "expired" };
  }
  if (sessionRow.status !== "in_progress") {
    return { valid: false, reason: "not_in_progress" };
  }

  return { valid: true, session: sessionRow as PlaySessionRow };
}

/** 세션 소유 자녀가 요청한 childId와 실제로 일치하는지 확인한다(위조/불일치 핸드오프 차단용). */
export function checkChildOwnership(session: PlaySessionRow, childId: string): boolean {
  return session.child_id === childId;
}
