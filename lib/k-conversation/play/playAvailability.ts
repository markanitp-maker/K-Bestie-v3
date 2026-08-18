import { getSupabaseTarget } from "@/lib/supabase/env";

/**
 * 케이 놀이 전체 kill switch.
 *
 * 게임별로 각각 막지 않는다. Registry 에 새 놀이가 추가돼도 자동으로 함께 막혀야 한다.
 * 프로덕션 품질 사고로 2026-08-18 부터 프로덕션만 꺼 둔 상태다(요청서 010).
 * 대표님 Dev QA 승인 전에는 프로덕션에서 켜지 않는다.
 */
export function isKPlayEnabled(): boolean {
  const override = process.env.NEXT_PUBLIC_K_PLAY_ENABLED?.trim().toLowerCase();
  if (override === "true") {
    return true;
  }
  return getSupabaseTarget() !== "prod";
}
