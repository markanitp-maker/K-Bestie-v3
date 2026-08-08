"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";

function currentKstPeriod(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).format(new Date()).slice(0, 7);
}

function shiftPeriod(period: string, monthOffset: number): string {
  const [year, month] = period.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

const CURRENT_PERIOD = currentKstPeriod();
const PERIODS = Array.from({ length: 7 }, (_, index) => shiftPeriod(CURRENT_PERIOD, index - 3));

interface EntryRow {
  rank: number;
  childId?: string;
  child_id?: string;
  childName?: string | null;
  loginId?: string | null;
  familyName?: string | null;
  isInternalTest?: boolean;
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

export default function QuizLeaderboardEventsTab({
  externalSearch = "",
  includeTestAccounts = false,
}: {
  externalSearch?: string;
  includeTestAccounts?: boolean;
} = {}) {
  const [period, setPeriod] = useState(CURRENT_PERIOD);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/events/quiz-leaderboard?period=${period}${includeTestAccounts ? "&includeTestAccounts=true" : ""}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ period, status: "unavailable", error: "request_failed" }))
      .finally(() => setLoading(false));
  }, [includeTestAccounts, period]);

  useEffect(() => { load(); }, [load]);

  const entries = (data?.entries ?? []).map((e) => ({
    rank: e.rank,
    childId: e.childId ?? e.child_id ?? "",
    childName: e.childName ?? null,
    loginId: e.loginId ?? null,
    familyName: e.familyName ?? null,
    isInternalTest: e.isInternalTest ?? false,
    score: e.score,
    correctCount: e.correctCount ?? e.correct_count ?? 0,
    completedQuizCount: e.completedQuizCount ?? e.completed_quiz_count ?? 0,
    isSeedUser: e.isSeedUser ?? e.is_seed_user ?? false,
    rewardEligible: e.rewardEligible ?? e.reward_eligible ?? true,
    rewardAmount: e.rewardAmount ?? e.reward_amount ?? 0,
  })).filter((entry) => {
    const needle = externalSearch.trim().toLocaleLowerCase("ko");
    return !needle || [entry.childName, entry.loginId, entry.familyName].join(" ").toLocaleLowerCase("ko").includes(needle);
  });
  const rewardTop3 = entries.filter((entry) => !entry.isSeedUser && entry.rewardEligible).slice(0, 3);

  return (
    <div>
      <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", color: "var(--admin-text-primary)", marginBottom: "var(--admin-space-12)" }}>
        퀴즈 리더보드
      </h2>

      <div style={{ display: "flex", gap: "var(--admin-space-8)", marginBottom: "var(--admin-space-16)", overflowX: "auto", paddingBottom: 4 }}>
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
          {rewardTop3.length > 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 8 }}>
                {rewardTop3.map((entry) => (
                  <div key={entry.childId} style={{ padding: 14, border: "1px solid var(--admin-border)", borderRadius: 12, background: "var(--admin-surface)" }}>
                    <strong>{entry.rank}위 · {entry.childName || "이름 미등록"}</strong>
                    <div style={{ color: "var(--admin-text-secondary)", marginTop: 4 }}>{entry.score.toLocaleString("ko-KR")}점 · {entry.rewardAmount.toLocaleString("ko-KR")}원</div>
                  </div>
                ))}
              </div>
              <a href="/admin/events-rewards?tab=fulfillments" style={{ display: "inline-flex", marginBottom: "var(--admin-space-16)", color: "var(--admin-primary)", fontWeight: 700 }}>지급 관리에서 보기</a>
            </>
          )}
          <AdminResponsiveTable mobileStrategy="card"
            columns={[
              { key: "rank", header: "순위", render: (r) => r.rank },
              { key: "child", header: "아이", render: (r) => {
                const label = r.childName || "이름 미등록";
                if (r.isSeedUser) return `${label} (더미)`;
                return <div><a href={`/admin/users?tab=children&search=${encodeURIComponent(label)}`} style={{ color: "var(--admin-primary)", fontWeight: 700, textDecoration: "none" }}>{label}</a>{r.isInternalTest && <span style={{ marginLeft: 6 }}><AdminStatusBadge text="[테스트]" variant="neutral" /></span>}<br/><span style={{ color: "var(--admin-text-secondary)", fontSize: "var(--admin-text-xs)" }}>{r.loginId || "미등록"} · {r.familyName || "가족 미등록"}</span></div>;
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
