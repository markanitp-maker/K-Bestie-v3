"use client";

import { useEffect, useState } from "react";

interface MissionEventDetail {
  status: "not_started" | "active" | "max_completed" | "completed";
  mission_completed_count?: number;
  current_reward_amount?: number;
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

// 부모 화면 — 현재 선택된 자녀(selectedChildId) 1명의 미션 30일 이벤트 현황만 표시한다
// (형진님 2026-08-04 지시: 부모 홈은 selectedChildId 기준 상세 화면이라는 원칙에 맞춰
// 형제자매 전체 목록을 노출하지 않는다). 팝업 acknowledgement와 무관하게 항상 조회.
export function ParentMissionEventStatus({
  childId,
  childName,
}: {
  childId: string | null;
  childName: string;
}) {
  const [detail, setDetail] = useState<MissionEventDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!childId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetail(null); // 이전 아이 데이터가 남아 잠깐 섞여 보이지 않도록 즉시 비운다.
    fetch(`/api/events/mission-onboarding/my-status?childId=${encodeURIComponent(childId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        // claude-review 재지적: 자녀를 A→B→A처럼 빠르게 전환하면 먼저 보낸 요청의 응답이
        // 나중에 도착해 현재 선택된 아이와 다른 데이터로 덮어쓸 수 있다(§9 캐시 노출 금지).
        if (!cancelled) setDetail(res?.missionEvent ?? null);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [childId]);

  if (!childId || loading || !detail) return null;

  const count = detail.mission_completed_count ?? 0;
  const remaining = daysRemaining(detail.ends_at);
  const navy = "var(--color-k-navy, #1A2B4C)";

  // requests/request_parent_home_event_card_compact_layout.md §10 — 상태별 좌우 문구.
  // 기존 코드는 status==="completed"(종료)를 별도로 다루지 않아 "시작 전"으로 잘못
  // 표시되는 결함이 있었다(§10.4 대상 상태가 분기에서 빠져 있었음) — 여기서 함께 고친다.
  let leftLine2: string;
  let rightLine1: string;
  let rightLine2: string | null;

  if (detail.status === "not_started") {
    leftLine2 = `현재 달성 상품권: ${won(detail.current_reward_amount)}`;
    rightLine1 = "첫 미션 완료 후 시작돼요.";
    rightLine2 = "이벤트 시작 전이에요.";
  } else if (detail.status === "completed") {
    leftLine2 = `최종 달성 상품권: ${won(detail.current_reward_amount)}`;
    rightLine1 = "이벤트가 종료됐어요.";
    rightLine2 = "최종 결과를 확인해 주세요.";
  } else {
    // active / max_completed
    leftLine2 = `현재 달성 상품권: ${won(detail.current_reward_amount)}`;
    rightLine1 = detail.nextTierRemaining
      ? `다음 단계까지 ${detail.nextTierRemaining.remaining}번 남았어요.`
      : "최고 목표를 달성했어요.";
    rightLine2 = remaining !== null ? `이벤트 종료까지 ${remaining}일 남았어요.` : null;
  }

  return (
    <section
      className="rounded-[20px] p-4 mb-6 shadow-sm bg-white border border-gray-100"
      aria-label={`${childName} 케이와 친해지는 30일 이벤트 현황`}
    >
      <h3 className="text-sm font-bold mb-2" style={{ color: navy }}>
        케이와 친해지는 30일 이벤트
      </h3>
      <div className="flex items-stretch gap-3">
        <div className="flex-1 min-w-0 text-xs space-y-1" style={{ color: navy }}>
          {/* claude-review 재지적: 이름+진행률을 한 줄로 묶어 truncate하면 이름이 길 때
              "N/60 완료" 자체가 통째로 잘려 안 보일 수 있다(§6 진행률은 가장 강조도가
              높은 핵심 정보) — 이름만 줄이고 진행률은 항상 보이게 분리한다. */}
          <p className="font-bold text-sm flex items-baseline gap-1">
            <span className="truncate min-w-0">{childName}</span>
            <span className="shrink-0 whitespace-nowrap">{count}/60 완료</span>
          </p>
          <p className="break-words">{leftLine2}</p>
        </div>
        <div className="w-px self-stretch" style={{ background: "var(--color-k-border)" }} />
        <div className="flex-1 min-w-0 text-xs space-y-1" style={{ color: navy }}>
          <p className="break-words">{rightLine1}</p>
          {rightLine2 && <p className="break-words">{rightLine2}</p>}
        </div>
      </div>
    </section>
  );
}
