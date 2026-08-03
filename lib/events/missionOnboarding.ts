import { SupabaseClient } from "@supabase/supabase-js";
import { getAppEventEnvironment } from "@/lib/events/environment";

/** 미션이 방금 공식적으로 완료된 시점에 호출한다(V1: trueCompleted && !trueWasCompleted,
 *  V2: rpcResult.newly_completed). 30일 온보딩 이벤트 인스턴스 생성/집계는 서버 RPC
 *  (record_mission_event_completion, migration 20260804010000)가 원자적·멱등으로
 *  처리하므로 여기서는 파라미터만 넘긴다. 실패해도 미션 완료 응답 자체는 막지 않는다
 *  (기존 earnMissionCompleteKey 실패 처리와 동일 원칙 — 부가 이벤트 집계는 핵심 플로우를
 *  막지 않는다). */
export async function recordMissionOnboardingCompletion(
  service: SupabaseClient,
  childId: string,
  missionSessionId: string,
  completedAt: Date = new Date()
): Promise<void> {
  try {
    const { error } = await service.rpc("record_mission_event_completion", {
      p_child_id: childId,
      p_environment: getAppEventEnvironment(),
      p_mission_session_id: missionSessionId,
      p_mission_completed_at: completedAt.toISOString(),
    });
    if (error) {
      console.error("[missionOnboarding] record_mission_event_completion failed:", error.message);
    }
  } catch (err) {
    console.error("[missionOnboarding] record_mission_event_completion exception:", (err as Error).message);
  }
}
