import "server-only";

import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { maskUserId } from "./masking";
import type { QuizLeaderboardPublicEntry, QuizLeaderboardRow } from "./types";

/**
 * 리더보드 조회. 고유 단위는 child_id(아이)이고, 시드(더미) 경쟁자와 실사용자는
 * 완전히 같은 테이블·같은 정렬 풀에서 처리된다(더미 전용 배열이나 더미 전용 필터
 * 없음 — 실제 아이의 누적 점수가 더 높으면 그대로 더미 위로 올라간다).
 *
 * 정렬 기준(확정):
 *   1) cumulative_score DESC
 *   2) cumulative_time  ASC   (동점이면 누적 풀이시간이 짧은 쪽)
 *   3) updated_at       ASC   (그마저 같으면 먼저 달성한 쪽)
 * 앞의 두 키는 이 기능이 포팅돼 온 시점부터 확정돼 있던 기준 그대로다. 세 번째
 * 키만 deterministic tie-break로 새로 못박았다(기존에는 tie-break가 없어 같은
 * 점수·같은 시간이면 순서가 비결정적이었다).
 * DB 정렬(order 체인)과 순위 계산(getSelfEntry의 count 조건)은 반드시 이 3단 기준을
 * 동일하게 사용해야 한다.
 */

const DEFAULT_TOP_N = 10;
const DEFAULT_REWARD_TOP_N = 3;

const LEADERBOARD_COLUMNS =
  "child_id, user_id, name, login_id, is_seed_user, is_reward_eligible, cumulative_score, cumulative_time, completed_attempts, created_at, updated_at";

export interface QuizLeaderboardSelf {
  rank: number;
  entry: QuizLeaderboardPublicEntry;
}

/** child_id를 되돌릴 수 없는 안정적 렌더 key로 바꾼다(다른 가정 아이 UUID 비노출). */
function toEntryKey(childId: string): string {
  return createHash("sha256").update(`quiz-leaderboard:${childId}`).digest("hex").slice(0, 16);
}

function toPublicEntry(
  row: QuizLeaderboardRow,
  selfChildId: string | null
): QuizLeaderboardPublicEntry {
  // child_id/user_id/login_id 원본은 응답에서 제거한다.
  const { child_id, user_id, login_id, ...rest } = row;
  void user_id;
  return {
    ...rest,
    entry_key: toEntryKey(child_id),
    masked_id: maskUserId(login_id),
    is_self: selfChildId != null && child_id === selfChildId,
  };
}

export async function getLeaderboardTop(
  limit: number = DEFAULT_TOP_N,
  selfChildId: string | null = null
): Promise<QuizLeaderboardPublicEntry[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("quiz_leaderboard")
    .select(LEADERBOARD_COLUMNS)
    .order("cumulative_score", { ascending: false })
    .order("cumulative_time", { ascending: true })
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`getLeaderboardTop: ${error.message}`);

  return ((data ?? []) as unknown as QuizLeaderboardRow[]).map((row) =>
    toPublicEntry(row, selfChildId)
  );
}

export async function getRewardEligibleEntries(
  limit: number = DEFAULT_REWARD_TOP_N
): Promise<QuizLeaderboardPublicEntry[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("quiz_leaderboard")
    .select(LEADERBOARD_COLUMNS)
    .eq("is_reward_eligible", true)
    .order("cumulative_score", { ascending: false })
    .order("cumulative_time", { ascending: true })
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`getRewardEligibleEntries: ${error.message}`);

  return ((data ?? []) as unknown as QuizLeaderboardRow[]).map((row) => toPublicEntry(row, null));
}

/**
 * 상위 목록 밖이어도 이 아이 본인의 순위·누적점수·누적시간·완료횟수를 돌려준다.
 * 순위 = 위 3단 정렬 기준으로 "나보다 앞선 행 수 + 1".
 */
export async function getSelfEntry(
  childId: string | null | undefined
): Promise<QuizLeaderboardSelf | null> {
  if (!childId) return null;

  const supabase = createServiceClient();

  const { data: target, error: targetError } = await supabase
    .from("quiz_leaderboard")
    .select(LEADERBOARD_COLUMNS)
    .eq("child_id", childId)
    .maybeSingle();

  if (targetError) throw new Error(`getSelfEntry: ${targetError.message}`);
  if (!target) return null;

  const row = target as unknown as QuizLeaderboardRow;

  const { count, error: countError } = await supabase
    .from("quiz_leaderboard")
    .select("child_id", { count: "exact", head: true })
    .or(
      [
        `cumulative_score.gt.${row.cumulative_score}`,
        `and(cumulative_score.eq.${row.cumulative_score},cumulative_time.lt.${row.cumulative_time})`,
        `and(cumulative_score.eq.${row.cumulative_score},cumulative_time.eq.${row.cumulative_time},updated_at.lt.${row.updated_at})`,
      ].join(",")
    );

  if (countError) throw new Error(`getSelfEntry: ${countError.message}`);

  return { rank: (count ?? 0) + 1, entry: toPublicEntry(row, childId) };
}

/** 이 아이의 현재 순위만 필요할 때(제출 응답용). 행이 없으면 null. */
export async function getRankForChild(
  childId: string | null | undefined
): Promise<number | null> {
  const self = await getSelfEntry(childId);
  return self?.rank ?? null;
}
