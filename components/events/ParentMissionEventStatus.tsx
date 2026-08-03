"use client";

import { useEffect, useState } from "react";

interface ChildMissionEventSummary {
  childId: string;
  name: string;
  missionEvent: {
    status: "not_started" | "active" | "max_completed" | "completed";
    mission_completed_count?: number;
    current_reward_amount?: number;
    ends_at?: string;
  };
}

function won(n?: number): string {
  return `${(n ?? 0).toLocaleString("ko-KR")}원`;
}

// 부모 화면 — 자녀별 미션 30일 이벤트 현황(요청서 §8.1). 항상 조회(팝업 acknowledgement와 무관).
export function ParentMissionEventStatus() {
  const [children, setChildren] = useState<ChildMissionEventSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/events/mission-onboarding/my-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => setChildren(res?.children ?? []))
      .catch(() => setChildren([]));
  }, []);

  if (!children || children.length === 0) return null;

  return (
    <div className="rounded-[20px] p-4 mb-6 shadow-sm bg-white border border-gray-100">
      <p className="text-sm font-bold mb-2" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
        케이와 친해지는 30일 이벤트
      </p>
      <div className="space-y-2">
        {children.map((c) => (
          <div key={c.childId} className="text-xs" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
            <span className="font-bold">{c.name}</span>
            {": "}
            {c.missionEvent.status === "not_started"
              ? "시작 전"
              : c.missionEvent.status === "completed"
              ? "종료됨"
              : `${c.missionEvent.mission_completed_count ?? 0}/60 완료 · 현재 ${won(c.missionEvent.current_reward_amount)} 구간`}
          </div>
        ))}
      </div>
    </div>
  );
}
