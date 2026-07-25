import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { maskUserId } from "./masking";
import type { QuizLeaderboardPublicEntry, QuizLeaderboardRow } from "./types";

// 퀴즈마스터 프로젝트에서 포팅 — createAdminClient() → createServiceClient()만 교체.

const DEFAULT_TOP_N = 10;
const DEFAULT_REWARD_TOP_N = 3;

const LEADERBOARD_COLUMNS =
  "user_id, name, login_id, is_seed_user, is_reward_eligible, cumulative_score, cumulative_time, created_at, updated_at";

function toPublicEntry(row: QuizLeaderboardRow): QuizLeaderboardPublicEntry {
  const { login_id, ...rest } = row;
  return { ...rest, masked_id: maskUserId(login_id) };
}

export async function getLeaderboardTop(
  limit: number = DEFAULT_TOP_N
): Promise<QuizLeaderboardPublicEntry[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("quiz_leaderboard")
    .select(LEADERBOARD_COLUMNS)
    .order("cumulative_score", { ascending: false })
    .order("cumulative_time", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`getLeaderboardTop: ${error.message}`);

  return ((data ?? []) as unknown as QuizLeaderboardRow[]).map(toPublicEntry);
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
    .limit(limit);

  if (error) throw new Error(`getRewardEligibleEntries: ${error.message}`);

  return ((data ?? []) as unknown as QuizLeaderboardRow[]).map(toPublicEntry);
}

export async function getRankForUser(userId: string): Promise<number | null> {
  const supabase = createServiceClient();

  const { data: target, error: targetError } = await supabase
    .from("quiz_leaderboard")
    .select("cumulative_score, cumulative_time")
    .eq("user_id", userId)
    .maybeSingle();

  if (targetError) throw new Error(`getRankForUser: ${targetError.message}`);
  if (!target) return null;

  const { count, error: countError } = await supabase
    .from("quiz_leaderboard")
    .select("user_id", { count: "exact", head: true })
    .or(
      `cumulative_score.gt.${target.cumulative_score},and(cumulative_score.eq.${target.cumulative_score},cumulative_time.lt.${target.cumulative_time})`
    );

  if (countError) throw new Error(`getRankForUser: ${countError.message}`);

  return (count ?? 0) + 1;
}
