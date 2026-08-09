"use client";

import { useEffect, useState } from "react";

interface MissionEventStatus {
  status: "not_started" | "active" | "max_completed" | "completed";
  mission_completed_count?: number;
  // The status API still returns the detailed reward/timing fields. This compact
  // home summary intentionally leaves their presentation to the event detail UI.
  current_reward_amount?: number;
  final_reward_amount?: number;
  final_mission_count?: number;
  ends_at?: string;
  nextTierRemaining?: { nextTier: number; remaining: number } | null;
}

// 아이 홈 — 미션 30일 온보딩 이벤트 상시 진행 카드. 인사/미션 상태 말풍선과
// 주요 미션 카드 사이에 배치한다. 카드 조회만으로 이벤트를 시작시키지 않는다(순수 표시).
export default function MissionOnboardingCard() {
  const [data, setData] = useState<MissionEventStatus | null>(null);

  useEffect(() => {
    fetch("/api/events/mission-onboarding/my-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => setData(res?.missionEvent ?? null))
      .catch(() => setData(null));
  }, []);

  if (!data) return null;

  const count = data.mission_completed_count ?? 0;
  const progressCount = data.status === "completed"
    ? data.final_mission_count ?? count
    : count;
  const progressPercent = Math.min(100, (progressCount / 60) * 100);

  return (
    <div
      data-testid="mission-onboarding-card"
      className="w-full rounded-[18px] px-4 py-3 shadow-[0_5px_14px_rgba(155,95,42,0.10)]"
      style={{ background: "linear-gradient(135deg, #FFF7EA 0%, #FFECD5 100%)", border: "1px solid rgba(255,159,69,0.22)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[14px] font-bold" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
          케이와 친해지는 30일
        </p>
        <p className="shrink-0 text-[16px] font-extrabold" style={{ color: "var(--color-k-orange, #FF9F45)" }}>
          {progressCount}/60 완료
        </p>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/80"
        role="progressbar"
        aria-label="30일 미션 이벤트 진행률"
        aria-valuemin={0}
        aria-valuemax={60}
        aria-valuenow={progressCount}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${progressPercent}%`, background: "var(--color-k-orange, #FF9F45)" }}
        />
      </div>
    </div>
  );
}
