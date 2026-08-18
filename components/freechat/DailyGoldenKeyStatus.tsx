"use client";

// 요청서 011 §3-9 — 자유대화 화면의 "오늘의 황금열쇠" 상태 표시.
//
// 역할 분리(§3-17): GoldKeyRewardModal 은 "방금 받았다"는 축하 이벤트, 이 표시는
// "오늘 이미 받았는지" 를 대화 내내 확인하는 용도다.
//
// 조회 전에는 "아직 안 받았어" 를 먼저 보여주지 않는다(§3-11). 조회가 실패해도
// 미획득으로 단정하지 않고 표시를 숨긴다(§3-12) — 아이에게 기술 오류를 노출하지 않는다.

import type { FreechatDailyKeyStatus } from "@/lib/freechat/dailyKeyStatus";

interface Props {
  /** null 이면 아직 모른다는 뜻이다(조회 중이거나 조회 실패). */
  status: FreechatDailyKeyStatus | null;
  /** 조회가 진행 중인지. 진행 중에는 중립 스켈레톤을 보여준다. */
  loading: boolean;
}

export function DailyGoldenKeyStatus({ status, loading }: Props) {
  if (loading) {
    return (
      <div
        data-ui="freechat-daily-key-status"
        data-state="loading"
        className="flex items-center gap-2 rounded-full bg-white/70 px-3.5 py-1.5 shadow-sm backdrop-blur-md"
        aria-hidden="true"
      >
        <span className="text-[15px]">🔑</span>
        <span className="h-[13px] w-[104px] animate-pulse rounded-full bg-black/10" />
      </div>
    );
  }

  // 상태를 모르면 아무것도 단정하지 않는다.
  if (!status) return null;

  const earned = status.earnedToday;

  return (
    <div
      data-ui="freechat-daily-key-status"
      data-state={earned ? "earned" : "not-earned"}
      className="flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-1.5 shadow-sm backdrop-blur-md"
    >
      <span className="text-[15px]" aria-hidden="true">
        🔑
      </span>
      <span className="text-[12px] font-bold text-[var(--color-k-navy)]">오늘의 황금열쇠</span>
      <span
        className={`text-[12px] font-bold ${earned ? "text-[#0E8A4F]" : "text-[#6B7280]"}`}
      >
        {earned ? "오늘 받았어! ✓" : "아직 안 받았어"}
      </span>
    </div>
  );
}
