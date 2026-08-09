"use client";

import { useEffect, useState } from "react";

interface MissionEventStatus {
  status: "not_started" | "active" | "max_completed" | "completed";
  mission_completed_count?: number;
  current_reward_amount?: number;
  final_reward_amount?: number;
  final_mission_count?: number;
  ends_at?: string;
  nextTierRemaining?: { nextTier: number; remaining: number } | null;
}

function won(n?: number): string {
  return `${(n ?? 0).toLocaleString("ko-KR")}원`;
}

function daysRemaining(endsAt?: string): number | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

// 아이 홈 — 미션 30일 온보딩 이벤트 상시 진행 카드(요청서 §7). 인사 영역 바로 아래,
// 주요 미션 카드보다 위에 배치한다. 카드 조회만으로 이벤트를 시작시키지 않는다(순수 표시).
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
  const remaining = daysRemaining(data.ends_at);

  return (
    <div
      className="w-full max-w-[430px] mx-auto rounded-[20px] px-3.5 py-2.5 mb-1.5 shadow-sm"
      style={{ background: "linear-gradient(135deg, #FFF3E0 0%, #FFE8CC 100%)", border: "1px solid rgba(255,159,69,0.25)" }}
    >
      <p className="text-sm font-bold" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
        케이와 친해지는 30일
      </p>

      {data.status === "not_started" && (
        <div className="mt-1.5">
          <p className="text-xs leading-relaxed" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
            첫 미션을 완료하면 30일 이벤트가 시작돼요.
            <br />
            30일 동안 최대 60번의 미션에 도전해 보세요.
          </p>
        </div>
      )}

      {(data.status === "active" || data.status === "max_completed") && (
        <>
          <p className="text-lg font-bold mt-1" style={{ color: "var(--color-k-orange, #FF9F45)" }}>
            {count}/60 완료
          </p>
          <div className="w-full h-2 rounded-full bg-white/60 mt-2 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, (count / 60) * 100)}%`, background: "var(--color-k-orange, #FF9F45)" }}
            />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
            <div className="text-xs leading-snug" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
              <p>케이와 벌써 {count}번 이야기했어요!</p>
              <p>현재 {won(data.current_reward_amount)} 구간을 달성했어요.</p>
            </div>
            <div className="text-xs leading-snug" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
              {data.nextTierRemaining && <p>{data.nextTierRemaining.remaining}번 더 완료하면 {won(data.nextTierRemaining.nextTier)} 구간이에요.</p>}
              {remaining !== null && <p>이벤트 종료까지 {remaining}일 남았어요.</p>}
            </div>
          </div>
        </>
      )}

      {data.status === "completed" && (
        <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
          케이와 함께한 30일이 끝났어요.
          <br />
          총 {data.final_mission_count ?? count}번 미션을 완료했어요.
          {(data.final_reward_amount ?? 0) > 0 ? (
            <>
              <br />
              {won(data.final_reward_amount)} 지급 대상이에요. 상품권은 보호자에게 전달될 예정이에요.
            </>
          ) : (
            <>
              <br />
              앞으로도 케이와 재미있게 이야기해요.
            </>
          )}
        </p>
      )}
    </div>
  );
}
