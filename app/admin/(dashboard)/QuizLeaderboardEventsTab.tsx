"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminDataTable } from "@/components/admin/shell/AdminDataTable";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";

const PERIODS = ["2026-08", "2026-09", "2026-10"];

interface EntryRow {
  rank: number;
  childId?: string;
  child_id?: string;
  childName?: string | null;
  score: number;
  correctCount?: number;
  correct_count?: number;
  completedQuizCount?: number;
  completed_quiz_count?: number;
  isSeedUser?: boolean;
  is_seed_user?: boolean;
  rewardEligible?: boolean;
  reward_eligible?: boolean;
  rewardAmount?: number;
  reward_amount?: number;
}

interface LeaderboardResponse {
  period: string;
  status: "active" | "finalized" | "unavailable";
  finalizedAt?: string;
  scoringVersion?: string;
  entries?: EntryRow[];
  error?: string;
  lastKnownGoodAt?: string | null;
}

export default function QuizLeaderboardEventsTab() {
  const [period, setPeriod] = useState(PERIODS[0]);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/events/quiz-leaderboard?period=${period}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ period, status: "unavailable", error: "request_failed" }))
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const entries = (data?.entries ?? []).map((e) => ({
    rank: e.rank,
    childId: e.childId ?? e.child_id ?? "",
    childName: e.childName ?? null,
    score: e.score,
    correctCount: e.correctCount ?? e.correct_count ?? 0,
    completedQuizCount: e.completedQuizCount ?? e.completed_quiz_count ?? 0,
    isSeedUser: e.isSeedUser ?? e.is_seed_user ?? false,
    rewardEligible: e.rewardEligible ?? e.reward_eligible ?? true,
    rewardAmount: e.rewardAmount ?? e.reward_amount ?? 0,
  }));

  return (
    <div>
      <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", color: "var(--admin-text-primary)", marginBottom: "var(--admin-space-12)" }}>
        퀴즈 리더보드
      </h2>

      <div style={{ display: "flex", gap: "var(--admin-space-8)", marginBottom: "var(--admin-space-16)" }}>
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              padding: "var(--admin-space-6) var(--admin-space-12)", borderRadius: 8, fontSize: "var(--admin-text-sm)",
              fontWeight: period === p ? "var(--admin-weight-bold)" : "normal",
              border: period === p ? "1px solid var(--admin-focus)" : "1px solid var(--admin-border)",
              background: period === p ? "var(--admin-focus)" : "var(--admin-surface)",
              color: period === p ? "var(--admin-bg)" : "var(--admin-text-secondary)",
              cursor: "pointer",
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {data?.status === "unavailable" && (
        <div style={{ padding: "var(--admin-space-16)", background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 12, marginBottom: "var(--admin-space-16)" }}>
          <AdminStatusBadge text="조회 실패" variant="danger" />
          <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)", marginTop: 8 }}>
            {data.error === "not_configured"
              ? "퀴즈마스터 연동이 아직 설정되지 않았습니다(QUIZ_UPSTREAM_ORIGIN/QUIZ_INTERNAL_AUTH_SECRET)."
              : `오류: ${data.error}`}
            {data.lastKnownGoodAt && <> · 마지막 정상 조회: {new Date(data.lastKnownGoodAt).toLocaleString("ko-KR")}</>}
          </div>
        </div>
      )}

      {data && data.status !== "unavailable" && (
        <>
          <div style={{ display: "flex", gap: "var(--admin-space-16)", marginBottom: "var(--admin-space-12)", fontSize: "var(--admin-text-sm)", color: "var(--admin-text-secondary)" }}>
            <span>
              <AdminStatusBadge text={data.status === "finalized" ? "최종 확정" : "진행 중"} variant={data.status === "finalized" ? "success" : "info"} />
            </span>
            {data.scoringVersion && <span>산식: {data.scoringVersion}</span>}
            {data.finalizedAt && <span>확정 시각: {new Date(data.finalizedAt).toLocaleString("ko-KR")}</span>}
          </div>
          <AdminDataTable
            columns={[
              { key: "rank", header: "순위", render: (r) => r.rank },
              { key: "child", header: "아이", render: (r) => {
                const label = r.childName ?? r.childId.slice(0, 8);
                return r.isSeedUser ? `${label} (더미)` : label;
              } },
              { key: "score", header: "점수", render: (r) => r.score },
              { key: "correct", header: "정답 수", render: (r) => r.correctCount },
              { key: "completed", header: "완료 세션 수", render: (r) => r.completedQuizCount },
              { key: "reward", header: "상품권", render: (r) => (r.rewardEligible ? `${r.rewardAmount.toLocaleString("ko-KR")}원` : "지급대상 아님(더미)") },
            ]}
            data={entries}
            isLoading={loading}
            keyExtractor={(r) => `${r.rank}-${r.childId}`}
            emptyMessage="표시할 순위가 없습니다."
          />
        </>
      )}
    </div>
  );
}
