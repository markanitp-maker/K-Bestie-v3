/**
 * 게임 참여: MBTI — 부모 리포트 파이프라인용 완료 이벤트 기록 (US-012)
 *
 * `mbti_completion_events` 테이블은 별도 mbti 저장소의
 * `supabase/migrations/20260723150000_mbti_completion_events.sql`로 Dev Supabase에 이미
 * 생성돼 있다(공유 Supabase 프로젝트). 이 파일은 그 테이블에 기록만 하는 함수를
 * K-Bestie-v3 네이티브 /api/mbti/complete 라우트에서 재사용하기 위해 이식한 것이다.
 *
 * 이 함수는 `mbti_type`·`child_id`·`session_id`·시각만 기록한다. 문항별 답변 원문이나 양육
 * 팁 본문은 절대 파라미터로 받지도, 저장하지도 않는다.
 *
 * 호출부 계약: fire-and-forget 호출을 전제로 한다 — 실패해도 /api/mbti/complete의 200
 * 응답을 막아서는 안 된다. 호출부는 next/server의 after()로 응답 전송 이후 실행하고,
 * 반환된 Promise는 .catch()로 로깅만 해야 한다.
 */

import { createServiceClient } from "@/lib/supabase/server";
import type { MbtiType } from "@/lib/data/mbtiTypes";

export interface MbtiCompletionEventInput {
  childId: string;
  sessionId: string;
  mbtiType: MbtiType;
}

export async function recordMbtiCompletionEvent(
  input: MbtiCompletionEventInput,
): Promise<void> {
  const serviceClient = createServiceClient();

  const { error } = await serviceClient.from("mbti_completion_events").insert({
    child_id: input.childId,
    session_id: input.sessionId,
    mbti_type: input.mbtiType,
  });

  if (error) {
    // session_id UNIQUE 제약 위반(23505)은 같은 완료 이벤트가 이미 기록됐다는 뜻이므로
    // 호출부 입장에서는 오류가 아니라 idempotent no-op으로 취급한다.
    if (error.code === "23505") {
      return;
    }
    throw error;
  }
}
