/**
 * 퀴즈 리더보드 조회 — 직접 DB 조회 방식 (2026-08-04 대표 지시로 HTTP API 방식에서 전환).
 * requests/request_kbestie_app_events.md §11, .omc/specs/deep-interview-kbestie-app-events.md §7.
 *
 * K-Bestie-v3와 퀴즈마스터는 Dev/Prod 각각 동일한 물리 Supabase 프로젝트를 공유한다
 * (실측 확인: service_role로 quiz_monthly_leaderboard_aggregates/quiz_leaderboard/
 * quiz_leaderboard_final_snapshots/quiz_leaderboard_final_entries 전부 직접 조회 성공).
 * 이 사실을 근거로 별도 HTTP 리더보드 조회 API와 quiz.leaderboard.finalized.v1 웹훅
 * 수신 API를 중복 구현하지 않는다 — 퀴즈마스터가 쓴 테이블을 K-Bestie가 그대로 읽는다.
 *
 * - 마감 전(진행 중): quiz_monthly_leaderboard_aggregates(실제 아이, 이번 period만,
 *   is_eligible=true) + quiz_leaderboard(is_seed_user=true 더미, 월과 무관하게 고정
 *   점수 유지 — 퀴즈마스터 스펙 §2.4)를 병합해 정렬한다.
 * - 마감 후: 퀴즈마스터가 이미 확정한 quiz_leaderboard_final_snapshots/
 *   quiz_leaderboard_final_entries를 그대로 읽는다(K-Bestie가 다시 계산하지 않음).
 *
 * 정렬: 월 누적점수 DESC → 월 누적 풀이시간 ASC → 최종점수 도달시각 ASC(NULLS LAST)
 *       → child_id ASC (퀴즈마스터 스펙 §2.3과 동일 4키 결정적 정렬).
 */

import { createServiceClient } from "@/lib/supabase/server";
import { getAppEventEnvironment } from "@/lib/events/environment";

export interface QuizLeaderboardEntry {
  rank: number;
  childId: string;
  score: number;
  correctCount: number | null;
  completedQuizCount: number | null;
  isSeedUser: boolean;
  rewardEligible: boolean;
  rewardAmount?: number;
}

export interface QuizLeaderboardResponse {
  period: string;
  status: "active" | "finalized";
  asOf: string;
  scoringVersion: string;
  finalizedAt?: string;
  entries: QuizLeaderboardEntry[];
}

export type QuizLeaderboardResult =
  | { ok: true; data: QuizLeaderboardResponse }
  | { ok: false; error: string };

const VALID_PERIODS = new Set(["2026-08", "2026-09", "2026-10"]);
const REWARD_BY_RANK: Record<number, number> = { 1: 5000, 2: 3000, 3: 1000 };

type MergedRow = {
  childId: string;
  score: number;
  cumulativeTime: number;
  finalScoreAchievedAt: string | null;
  correctCount: number | null;
  completedQuizCount: number | null;
  isSeedUser: boolean;
  rewardEligible: boolean;
};

function sortEntries(rows: MergedRow[]): MergedRow[] {
  return [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.cumulativeTime !== b.cumulativeTime) return a.cumulativeTime - b.cumulativeTime;
    const aT = a.finalScoreAchievedAt ? new Date(a.finalScoreAchievedAt).getTime() : Number.POSITIVE_INFINITY;
    const bT = b.finalScoreAchievedAt ? new Date(b.finalScoreAchievedAt).getTime() : Number.POSITIVE_INFINITY;
    if (aT !== bT) return aT - bT;
    return a.childId < b.childId ? -1 : a.childId > b.childId ? 1 : 0;
  });
}

export async function fetchQuizLeaderboard(period: string): Promise<QuizLeaderboardResult> {
  if (!VALID_PERIODS.has(period)) {
    return { ok: false, error: "invalid_period" };
  }

  const environment = getAppEventEnvironment();
  const db = createServiceClient();

  try {
    // 1) 이미 마감 확정된 달이면 퀴즈마스터의 확정 스냅샷을 그대로 읽는다.
    const { data: snapshot, error: snapshotErr } = await db
      .from("quiz_leaderboard_final_snapshots")
      .select("id, finalized_at, scoring_version")
      .eq("environment", environment)
      .eq("period_key", period)
      .maybeSingle();

    if (snapshotErr) {
      console.error("[quizLeaderboardClient] final_snapshots query failed:", snapshotErr.message);
      return { ok: false, error: "db_error" };
    }

    if (snapshot) {
      const { data: entries, error: entriesErr } = await db
        .from("quiz_leaderboard_final_entries")
        .select("rank, child_id, score, correct_count, incorrect_count, completed_quiz_count, reward_amount")
        .eq("snapshot_id", snapshot.id)
        .order("rank");

      if (entriesErr) {
        console.error("[quizLeaderboardClient] final_entries query failed:", entriesErr.message);
        return { ok: false, error: "db_error" };
      }

      return {
        ok: true,
        data: {
          period,
          status: "finalized",
          asOf: snapshot.finalized_at,
          finalizedAt: snapshot.finalized_at,
          scoringVersion: snapshot.scoring_version,
          entries: (entries ?? []).map((e) => ({
            rank: e.rank,
            childId: e.child_id,
            score: e.score,
            correctCount: e.correct_count,
            completedQuizCount: e.completed_quiz_count,
            isSeedUser: false, // 확정 스냅샷은 실제 아이 TOP3만 포함(퀴즈마스터 스펙 §2.9)
            rewardEligible: true,
            rewardAmount: e.reward_amount,
          })),
        },
      };
    }

    // 2) 아직 진행 중 — 실제 아이 월간 집계 + 더미(quiz_leaderboard.is_seed_user) 병합.
    const [realResult, dummyResult] = await Promise.allSettled([
      db
        .from("quiz_monthly_leaderboard_aggregates")
        .select("child_id, score, correct_count, completed_quiz_count, cumulative_time, final_score_achieved_at, scoring_version")
        .eq("environment", environment)
        .eq("period_key", period)
        .eq("is_eligible", true),
      db
        .from("quiz_leaderboard")
        .select("child_id, cumulative_score, cumulative_time, completed_attempts")
        .eq("is_seed_user", true),
    ]);

    if (realResult.status === "rejected" || realResult.value.error) {
      const msg = realResult.status === "rejected" ? realResult.reason : realResult.value.error?.message;
      console.error("[quizLeaderboardClient] monthly aggregates query failed:", msg);
      return { ok: false, error: "db_error" };
    }
    if (dummyResult.status === "rejected" || dummyResult.value.error) {
      const msg = dummyResult.status === "rejected" ? dummyResult.reason : dummyResult.value.error?.message;
      console.error("[quizLeaderboardClient] dummy rows query failed:", msg);
      return { ok: false, error: "db_error" };
    }

    const realRows: MergedRow[] = (realResult.value.data ?? []).map((r) => ({
      childId: r.child_id,
      score: r.score,
      cumulativeTime: r.cumulative_time,
      finalScoreAchievedAt: r.final_score_achieved_at,
      correctCount: r.correct_count,
      completedQuizCount: r.completed_quiz_count,
      isSeedUser: false,
      rewardEligible: true,
    }));
    const dummyRows: MergedRow[] = (dummyResult.value.data ?? []).map((d) => ({
      childId: d.child_id,
      score: d.cumulative_score,
      cumulativeTime: d.cumulative_time,
      finalScoreAchievedAt: null,
      correctCount: null,
      completedQuizCount: d.completed_attempts,
      isSeedUser: true,
      rewardEligible: false,
    }));

    const sorted = sortEntries([...realRows, ...dummyRows]);
    const scoringVersion = realResult.value.data?.[0]?.scoring_version ?? "v1-10pt-per-question";

    return {
      ok: true,
      data: {
        period,
        status: "active",
        asOf: new Date().toISOString(),
        scoringVersion,
        entries: sorted.map((r, i) => ({
          rank: i + 1,
          childId: r.childId,
          score: r.score,
          correctCount: r.correctCount,
          completedQuizCount: r.completedQuizCount,
          isSeedUser: r.isSeedUser,
          rewardEligible: r.rewardEligible,
          rewardAmount: !r.isSeedUser && i < 3 ? REWARD_BY_RANK[i + 1] : 0,
        })),
      },
    };
  } catch (err) {
    console.error("[quizLeaderboardClient] unexpected error:", (err as Error).message);
    return { ok: false, error: "unexpected_error" };
  }
}
