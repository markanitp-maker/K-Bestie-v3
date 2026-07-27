// 서버전용 진행/완료/닫기/오류 API의 idempotencyKey 중복 방지 (딥 인터뷰 Round 8-3).
//
// 같은 idempotencyKey로 재요청이 오면 최초 처리 때 반환한 응답 본문을 그대로
// 다시 돌려주고, 실제 부작용(progress_state 갱신, confirm 등)은 다시 실행하지 않는다.

import { createServiceClient } from "@/lib/supabase/server";

export type InternalEventType = "progress" | "complete" | "close" | "error";

/** 이미 처리된 idempotencyKey면 캐싱된 응답을 반환한다. 없으면 null. */
export async function findIdempotentResponse(idempotencyKey: string): Promise<unknown | null> {
  const service = createServiceClient();
  const { data } = await service
    .from("play_internal_event_idempotency")
    .select("response_body")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  return data ? data.response_body : null;
}

/** 처리 결과를 idempotencyKey와 함께 기록한다. 이미 같은 키로 기록된 경우 무시한다
 * (동시 요청 경합 시 먼저 커밋된 쪽이 정본이 되도록 UNIQUE 제약에 맡긴다). */
export async function recordIdempotentResponse(
  idempotencyKey: string,
  playSessionId: string,
  eventType: InternalEventType,
  responseBody: unknown,
): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.from("play_internal_event_idempotency").insert({
    idempotency_key: idempotencyKey,
    play_session_id: playSessionId,
    event_type: eventType,
    response_body: responseBody,
  });

  if (error && error.code !== "23505") {
    // 23505 = unique_violation(동시 요청 경합으로 이미 기록됨) — 정상 케이스, 무시.
    console.error("[internalEventIdempotency] 기록 실패:", error, { idempotencyKey, eventType });
  }
}
