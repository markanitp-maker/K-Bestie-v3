"use client";

import { useState, useEffect } from "react";
import { AdminKpiGrid, AdminKpiCard } from "@/components/admin/shell/AdminKpiCard";

interface MissionEventRow {
  status: string;
  mission_completed_count: number;
  final_reward_amount: number | null;
  ends_at: string;
}
interface RewardRow {
  status: string;
  reward_amount: number;
}

export default function EventsOverviewTab() {
  const [missionEvents, setMissionEvents] = useState<MissionEventRow[] | null>(null);
  const [rewards, setRewards] = useState<RewardRow[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/events/mission-onboarding")
      .then((r) => (r.ok ? r.json() : []))
      .then(setMissionEvents)
      .catch(() => setMissionEvents([]));
    fetch("/api/admin/events/reward-fulfillments")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRewards)
      .catch(() => setRewards([]));
  }, []);

  if (!missionEvents || !rewards) {
    return <div style={{ padding: "var(--admin-space-24)", color: "var(--admin-text-secondary)" }}>불러오는 중...</div>;
  }

  const notStarted = missionEvents.filter((e) => e.status === "active" && e.mission_completed_count === 0).length;
  const active = missionEvents.filter((e) => e.status === "active" && e.mission_completed_count > 0).length;
  const now = Date.now();
  const in7Days = missionEvents.filter(
    (e) => e.status !== "completed" && new Date(e.ends_at).getTime() - now <= 7 * 24 * 60 * 60 * 1000 && new Date(e.ends_at).getTime() > now
  ).length;
  const tier10 = missionEvents.filter((e) => e.mission_completed_count >= 10).length;
  const tier30 = missionEvents.filter((e) => e.mission_completed_count >= 30).length;
  const tier50 = missionEvents.filter((e) => e.mission_completed_count >= 50).length;
  const tier60 = missionEvents.filter((e) => e.mission_completed_count >= 60).length;
  const totalExpected = missionEvents.reduce((sum, e) => sum + (e.final_reward_amount ?? 0), 0);

  const byStatus = (s: string) => rewards.filter((r) => r.status === s).length;

  return (
    <div>
      <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", color: "var(--admin-text-primary)", marginBottom: "var(--admin-space-16)" }}>
        이벤트 현황
      </h2>
      <AdminKpiGrid>
        <AdminKpiCard title="미션 시작 전" value={`${notStarted}명`} />
        <AdminKpiCard title="미션 진행 중" value={`${active}명`} />
        <AdminKpiCard title="7일 내 종료" value={`${in7Days}명`} />
        <AdminKpiCard title="미션 예상 총 지급액" value={`${totalExpected.toLocaleString("ko-KR")}원`} />
        <AdminKpiCard title="10회 달성" value={`${tier10}명`} />
        <AdminKpiCard title="30회 달성" value={`${tier30}명`} />
        <AdminKpiCard title="50회 달성" value={`${tier50}명`} />
        <AdminKpiCard title="60회 달성" value={`${tier60}명`} />
        <AdminKpiCard title="지급 대기" value={`${byStatus("pending")}건`} />
        <AdminKpiCard title="승인" value={`${byStatus("approved")}건`} />
        <AdminKpiCard title="발송 완료" value={`${byStatus("delivered")}건`} />
        <AdminKpiCard title="보류" value={`${byStatus("on_hold")}건`} />
      </AdminKpiGrid>
    </div>
  );
}
