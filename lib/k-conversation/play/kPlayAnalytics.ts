import type { SupabaseClient } from "@supabase/supabase-js";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

/**
 * 케이 놀이(자유대화 안 끝말잇기·초성게임·넌센스퀴즈) 계측.
 *
 * 게임 참여(MBTI·퀴즈마스터, `k_play_sessions`)와 **다른 지표**다. 그쪽은
 * `play_start`/`play_complete` 를 쓰므로 이름을 재사용하지 않는다. 섞이면
 * "게임 참여 아이" 수치가 오염된다.
 *
 * `behavior_events.play_type` 에는 CHECK 제약이 있어
 * ('comic_book','quiz','hairstyle','mbti') 밖의 값을 넣으면 insert 가 통째로
 * 실패한다. 그래서 play_type 은 비우고 스킬 id 는 `event_key` 에 담는다.
 * 프로덕션 스키마를 바꾸지 않기 위한 선택이다.
 */
export type KPlayEventName = "k_play_start" | "k_play_complete";

export interface RecordKPlayEventInput {
  db: SupabaseClient;
  childId: string;
  chatSessionId: string;
  skillId: string;
  route: string;
  /**
   * 테스트용 주입구. 기본값은 실제 기록 함수다.
   *
   * `mock.module` 은 `--experimental-test-module-mocks` 플래그가 있어야 돌아서
   * 평범한 `tsx --test` 에서는 조용히 죽는다(실제로 그렇게 통과했다고 잘못
   * 보고된 적이 있다). 주입이면 플래그 없이 어디서든 검증된다.
   */
  logEvent?: typeof logBehaviorEvent;
}

/**
 * 계측은 아이의 놀이를 절대 방해하면 안 된다.
 * await 하지 않고(아이를 기다리게 하지 않는다) 예외도 전부 삼킨다.
 * 기록이 실패해도 게임은 그대로 진행되어야 한다.
 */
export function recordKPlayEvent(
  eventName: KPlayEventName,
  input: RecordKPlayEventInput
): void {
  const { db, childId, chatSessionId, skillId, route, logEvent = logBehaviorEvent } = input;
  if (!childId || !chatSessionId || !skillId) return;

  void (async () => {
    let familyId: string | undefined;
    try {
      const { data } = await db
        .from("child_profiles")
        .select("family_id")
        .eq("id", childId)
        .single();
      if (data?.family_id) familyId = data.family_id;
    } catch {
      // family_id 를 못 구해도 기록은 남긴다. 아이 단위 집계에는 지장이 없다.
    }

    await logEvent({
      eventName,
      actorType: "child",
      childId,
      familyId,
      sessionId: chatSessionId,
      feature: "freechat",
      eventKey: skillId,
      route,
    });
  })().catch(() => {});
}
