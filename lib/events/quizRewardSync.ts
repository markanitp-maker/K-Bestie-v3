import { SupabaseClient } from "@supabase/supabase-js";
import { getAppEventEnvironment } from "@/lib/events/environment";

const PERIODS = ["2026-08", "2026-09", "2026-10"];

/** 퀴즈마스터가 이미 확정한 quiz_leaderboard_final_snapshots/entries를 읽어, 아직
 *  event_reward_fulfillments가 생성되지 않은 period가 있으면 생성한다(2026-08-04
 *  결정 — 웹훅 대신 직접 DB 동기화. quiz_leaderboard_final_entries는 퀴즈마스터
 *  스펙상 실제 아이 TOP3만 포함하므로 별도 더미 필터링이 필요 없다). event_type+
 *  event_reference_id unique 제약으로 멱등 — 여러 번 호출해도 중복 생성되지 않는다. */
export async function syncQuizRewardFulfillments(service: SupabaseClient): Promise<{ synced: number; skipped: number }> {
  const environment = getAppEventEnvironment();
  let synced = 0;
  let skipped = 0;

  for (const periodKey of PERIODS) {
    const { data: snapshot, error: snapshotErr } = await service
      .from("quiz_leaderboard_final_snapshots")
      .select("id, period_key")
      .eq("environment", environment)
      .eq("period_key", periodKey)
      .maybeSingle();

    if (snapshotErr) {
      console.error("[quizRewardSync] snapshot query failed:", snapshotErr.message, { periodKey });
      continue;
    }
    if (!snapshot) continue;

    // quiz_leaderboard_final_entries에는 id 컬럼이 없다(PK가 snapshot_id+rank 복합키,
    // 퀴즈마스터 소유 테이블). event_reference_id는 snapshot_id를 쓰고, 같은 snapshot
    // 아래 여러 아이를 구분하기 위해 child_id를 유니크 제약에 함께 넣었다
    // (20260804040000 마이그레이션 참고).
    const { data: entries, error: entriesErr } = await service
      .from("quiz_leaderboard_final_entries")
      .select("child_id, reward_amount")
      .eq("snapshot_id", snapshot.id);

    if (entriesErr) {
      console.error("[quizRewardSync] entries query failed:", entriesErr.message, { periodKey });
      continue;
    }

    for (const entry of entries ?? []) {
      if (!entry.reward_amount || entry.reward_amount <= 0) continue;

      const { error: insertErr } = await service.from("event_reward_fulfillments").insert({
        environment,
        event_type: "quiz_leaderboard",
        event_reference_id: snapshot.id,
        child_id: entry.child_id,
        reward_amount: entry.reward_amount,
      });

      if (insertErr) {
        // unique 위반(23505) = 이미 동기화됨. 그 외 에러만 실패로 집계.
        if (insertErr.code === "23505") {
          skipped++;
        } else {
          console.error("[quizRewardSync] insert failed:", insertErr.message, { snapshotId: snapshot.id, childId: entry.child_id });
        }
        continue;
      }
      synced++;
    }
  }

  return { synced, skipped };
}
