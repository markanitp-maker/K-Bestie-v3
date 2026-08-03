import { SupabaseClient } from "@supabase/supabase-js";

/** 미션 30일 이벤트를 읽기 직전에 지연평가한다(요청서 §10.2 "지연 평가와 정기 작업을
 *  모두 안전하게 지원"). Hobby 플랜은 크론이 하루 1회로 제한되어(§4 확정 스케줄
 *  5 15 * * * = 매일 00:05 KST) 종료 시각과 크론 실행 사이 최대 24시간 지연이
 *  생길 수 있다 — 실제 화면 조회 시점에 이 함수가 그 간극을 메운다. finalize
 *  RPC 자체가 멱등이라 크론과 겹쳐 호출돼도 안전하다. */
export async function lazyFinalizeIfDue(
  service: SupabaseClient,
  eventId: string,
  endsAt: string,
  status: string
): Promise<void> {
  if (status === "completed") return;
  if (new Date(endsAt).getTime() > Date.now()) return;

  const { error } = await service.rpc("finalize_mission_onboarding_event", { p_event_id: eventId });
  if (error) {
    console.error("[missionOnboardingRead] lazy finalize failed:", error.message, { eventId });
  }
}
