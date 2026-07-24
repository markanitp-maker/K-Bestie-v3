/**
 * 케이 놀이 공통 인프라 — 세션 완료 CAS(compare-and-swap) 전이
 *
 * k_play_sessions.status를 `in_progress` → `completed`로 전이하는 조건부 UPDATE를
 * 모든 놀이 타입이 재사용할 수 있도록 추출했다(MBTI 네이티브 통합, 2026-07-25).
 *
 * 동시성 가드: 진행 저장(progressState.ts)과 달리 이 전이는 numeric 버전 CAS를 쓰지
 * 않는다 — 상태 전이 자체(`status='in_progress'` → `'completed'`)가 compare-and-swap
 * 키다. 두 완료 요청이 거의 동시에 도착해도 WHERE 절의 `status='in_progress'`에
 * 매치되는 UPDATE는 둘 중 하나만 성공한다(승자). 진 쪽(`isWinner: false`)은 오류가
 * 아니라 "이미 다른 요청이 먼저 완료 처리함"을 뜻하는 idempotent 결과다 — 호출부는
 * 이 경우 완료 후속 이벤트(부모 리포트 기록 등)를 실행하면 안 된다(세션당 정확히
 * 1회만 기록되도록).
 *
 * 완료 시각(completedAt)은 호출부가 먼저 계산해서 넘긴다 — progress_state 안에 심는
 * 값(예: MBTI의 `mbti.completedAt`)과 DB의 `completed_at` 컬럼 값이 정확히 일치해야
 * 하기 때문이다(한 함수 안에서 두 번 `new Date()`를 부르면 미세하게 어긋날 수 있음).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CompleteSessionResult {
  isWinner: boolean;
  error?: unknown;
}

export async function completeInProgressSession(
  service: SupabaseClient,
  sessionId: string,
  nextProgressState: Record<string, unknown>,
  completedAt: string,
): Promise<CompleteSessionResult> {
  const { data, error } = await service
    .from("k_play_sessions")
    .update({
      status: "completed",
      completed_at: completedAt,
      progress_state: nextProgressState,
    })
    .eq("id", sessionId)
    .eq("status", "in_progress")
    .select("id");

  if (error) {
    return { isWinner: false, error };
  }
  return { isWinner: Boolean(data && data.length > 0) };
}
