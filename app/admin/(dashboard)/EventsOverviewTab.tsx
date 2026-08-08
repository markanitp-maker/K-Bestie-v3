"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminKpiGrid, AdminKpiCard } from "@/components/admin/shell/AdminKpiCard";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";

interface MissionEventRow {
  status: string;
  mission_completed_count: number;
  current_reward_amount: number;
  final_reward_amount: number | null;
  ends_at: string;
  childName: string;
  loginId: string;
  familyName: string;
}
interface RewardRow {
  status: string;
  reward_amount: number;
  childName: string;
  loginId: string;
  familyName: string;
}
interface AttendanceResponse {
  summary: { targetChildren: number; participatedChildren: number; notParticipatedChildren: number; totalKeysGranted: number };
  children: Array<{ name: string; username: string; todayStatus: "NOT_STARTED" | "RETRY_AVAILABLE" | "COMPLETED"; todayKeysGranted: number }>;
}
interface LeaderboardResponse {
  entries?: Array<{ rank: number; childId?: string; childName: string | null; loginId?: string | null; familyName?: string | null; score: number; isSeedUser: boolean; rewardEligible: boolean; rewardAmount?: number }>;
}

function currentKstPeriod() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

function matchesSearch(row: { childName?: string | null; loginId?: string | null; familyName?: string | null }, search: string) {
  const needle = search.trim().toLocaleLowerCase("ko");
  return !needle || [row.childName, row.loginId, row.familyName].join(" ").toLocaleLowerCase("ko").includes(needle);
}

export default function EventsOverviewTab({
  includeTestAccounts = false,
  externalSearch = "",
}: {
  includeTestAccounts?: boolean;
  externalSearch?: string;
} = {}) {
  const [missionEvents, setMissionEvents] = useState<MissionEventRow[] | null>(null);
  const [rewards, setRewards] = useState<RewardRow[] | null>(null);
  const [attendance, setAttendance] = useState<AttendanceResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);

  useEffect(() => {
    const query = includeTestAccounts ? "?includeTestAccounts=true" : "";
    const suffix = includeTestAccounts ? "&includeTestAccounts=true" : "";
    fetch(`/api/admin/events/mission-onboarding${query}`).then((r) => (r.ok ? r.json() : [])).then(setMissionEvents).catch(() => setMissionEvents([]));
    fetch(`/api/admin/events/reward-fulfillments${query}`).then((r) => (r.ok ? r.json() : [])).then(setRewards).catch(() => setRewards([]));
    fetch(`/api/admin/events/attendance-roulette${query}`).then((r) => (r.ok ? r.json() : null)).then(setAttendance).catch(() => setAttendance(null));
    fetch(`/api/admin/events/quiz-leaderboard?period=${currentKstPeriod()}${suffix}`).then((r) => (r.ok ? r.json() : null)).then(setLeaderboard).catch(() => setLeaderboard(null));
  }, [includeTestAccounts]);

  const visibleMissions = useMemo(() => (missionEvents ?? []).filter((row) => matchesSearch(row, externalSearch)), [externalSearch, missionEvents]);
  const visibleRewards = useMemo(() => (rewards ?? []).filter((row) => matchesSearch(row, externalSearch)), [externalSearch, rewards]);
  const visibleAttendance = useMemo(() => {
    if (!attendance || !externalSearch.trim()) return attendance;
    const needle = externalSearch.trim().toLocaleLowerCase("ko");
    const children = attendance.children.filter((child) => `${child.name} ${child.username}`.toLocaleLowerCase("ko").includes(needle));
    const participatedChildren = children.filter((child) => child.todayStatus !== "NOT_STARTED").length;
    return {
      ...attendance,
      summary: {
        targetChildren: children.length,
        participatedChildren,
        notParticipatedChildren: children.length - participatedChildren,
        totalKeysGranted: children.reduce((sum, child) => sum + child.todayKeysGranted, 0),
      },
      children,
    };
  }, [attendance, externalSearch]);

  if (!missionEvents || !rewards) {
    return <div style={{ padding: "var(--admin-space-24)", color: "var(--admin-text-secondary)" }}>불러오는 중...</div>;
  }

  const active = visibleMissions.filter((event) => event.status === "active" && event.mission_completed_count > 0).length;
  const now = Date.now();
  const in7Days = visibleMissions.filter((event) => event.status !== "completed" && new Date(event.ends_at).getTime() - now <= 7 * 86_400_000 && new Date(event.ends_at).getTime() > now).length;
  const distribution = {
    "0~9": visibleMissions.filter((event) => event.mission_completed_count < 10).length,
    "10~29": visibleMissions.filter((event) => event.mission_completed_count >= 10 && event.mission_completed_count < 30).length,
    "30~49": visibleMissions.filter((event) => event.mission_completed_count >= 30 && event.mission_completed_count < 50).length,
    "50~59": visibleMissions.filter((event) => event.mission_completed_count >= 50 && event.mission_completed_count < 60).length,
    "60": visibleMissions.filter((event) => event.mission_completed_count >= 60).length,
  };
  const totalExpected = visibleMissions.reduce((sum, event) => sum + (event.status === "active" ? event.current_reward_amount : (event.final_reward_amount ?? 0)), 0);
  const byStatus = (status: string) => visibleRewards.filter((reward) => reward.status === status).length;
  const top3 = (leaderboard?.entries ?? []).filter((entry) => !entry.isSeedUser && entry.rewardEligible && matchesSearch(entry, externalSearch)).slice(0, 3);

  return (
    <div style={{ width: "100%" }}>
      <AdminPageHeader title="이벤트·보상 개요" />
      <AdminKpiGrid>
        <AdminKpiCard title="미션 진행 중" value={`${active}명`} />
        <AdminKpiCard title="7일 내 종료" value={`${in7Days}명`} />
        <AdminKpiCard title="오늘 출석 참여" value={visibleAttendance ? `${visibleAttendance.summary.participatedChildren}명` : "조회 실패"} />
        <AdminKpiCard title="지급 대상 확인" value={`${byStatus("pending")}건`} />
        <AdminKpiCard title="미션 예상 총 지급액" value={`${totalExpected.toLocaleString("ko-KR")}원`} />
      </AdminKpiGrid>

      <h3 style={{ margin: "24px 0 10px", fontSize: 16 }}>미션 30일 현재 구간</h3>
      <AdminKpiGrid>
        {Object.entries(distribution).map(([range, count]) => <AdminKpiCard key={range} title={range} value={`${count}명`} />)}
      </AdminKpiGrid>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14, marginTop: 24 }}>
        <section style={{ padding: 16, borderRadius: 12, border: "1px solid var(--admin-border)", background: "var(--admin-surface)" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>퀴즈 리더보드 TOP3</h3>
          {leaderboard === null ? <p>조회 실패</p> : top3.length === 0 ? <p>표시할 실제 사용자가 없습니다.</p> : top3.map((entry) => <p key={`${entry.rank}-${entry.childName}`} style={{ margin: "6px 0" }}>{entry.rank}위 · <a href={`/admin/users?tab=children&search=${encodeURIComponent(entry.childName || entry.loginId || "")}`} style={{ color: "var(--admin-primary)", fontWeight: 700 }}>{entry.childName || "이름 미등록"}</a> · {entry.score.toLocaleString("ko-KR")}점</p>)}
        </section>
        <section style={{ padding: 16, borderRadius: 12, border: "1px solid var(--admin-border)", background: "var(--admin-surface)" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>출석 룰렛 오늘 현황</h3>
          {visibleAttendance ? <p style={{ margin: 0 }}>대상 {visibleAttendance.summary.targetChildren}명 · 참여 {visibleAttendance.summary.participatedChildren}명 · 미참여 {visibleAttendance.summary.notParticipatedChildren}명 · 지급 열쇠 {visibleAttendance.summary.totalKeysGranted}개</p> : <p>조회 실패</p>}
        </section>
        <section style={{ padding: 16, borderRadius: 12, border: "1px solid var(--admin-border)", background: "var(--admin-surface)" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>보상 지급 현황</h3>
          <p style={{ margin: 0 }}>확인 {byStatus("pending")} · 승인 {byStatus("approved")} · 예정 {byStatus("scheduled")} · 전달 완료 {byStatus("delivered")} · 보류 {byStatus("on_hold")}</p>
          <a href="/admin/events-rewards?tab=fulfillments" style={{ display: "inline-flex", marginTop: 10, color: "var(--admin-primary)", fontWeight: 700 }}>지급 관리에서 보기</a>
        </section>
      </div>
    </div>
  );
}
