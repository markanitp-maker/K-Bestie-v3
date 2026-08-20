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
        className="flex min-w-0 max-w-full flex-col items-center gap-1 rounded-2xl bg-white/70 px-2.5 py-1.5 shadow-sm backdrop-blur-md"
        aria-hidden="true"
      >
        <span className="shrink-0 text-[15px]">🔑</span>
        {/* 014 리뷰 MINOR — 실제 카드의 글자 블록은 2줄이다. 스켈레톤이 1줄이면
            조회가 끝나는 순간 카드 높이가 약 15px 튄다. 줄 수를 맞춘다. */}
        <span className="flex min-w-0 flex-col items-center gap-[2px] leading-tight">
          <span className="h-[13px] w-[84px] animate-pulse rounded-full bg-black/10" />
          <span className="h-[13px] w-[64px] animate-pulse rounded-full bg-black/10" />
        </span>
      </div>
    );
  }

  // 상태를 모르면 아무것도 단정하지 않는다.
  if (!status) return null;

  const earned = status.earnedToday;

  // 011 — 하단 오른쪽 칸에서 문구가 세로로 잘게 쪼개지던 문제.
  //
  // 예전에는 세 요소(🔑 / 라벨 / 상태)를 한 줄 flex 로 늘어놓았다. 칸이 좁아지면
  // 세 요소가 각각 따로 줄바꿈돼 카드가 세로로 길쭉해졌다(대표님 QA: "여러 줄로 세로
  // 쪼개져 잘못된 UI").
  //
  // 그래서 글자를 하나의 블록으로 묶었다. 라벨과 상태는 그 안에서만 쌓이므로
  // 최악의 경우에도 2줄이다. 글자 크기는 줄이지 않는다(지시서 금지).
  // `break-keep` 으로 한글 낱말이 중간에서 쪼개지지 않게 한다.
  //
  // 014 — 아이콘 위치를 왼쪽에서 위로 올린다(requests/a02.png 오른쪽 시안).
  // 아이콘 한 칸 + 글자 블록 한 칸이라는 구조는 그대로 두고 방향만 세로로 바꾼다.
  // 글자 블록이 여전히 하나이므로 011 에서 고친 "잘게 쪼개짐" 은 다시 생기지 않는다.
  //
  // 015 (requests/a03.png) — 흰 배경이 글자에 붙어야 한다.
  // 011 은 카드를 `w-full` 로 두고 칸을 `justify-self-stretch` 로 늘렸다. 그때는
  // 가로 배치(아이콘 왼쪽 + 글자 오른쪽)였고 폭이 좁으면 문구가 잘게 쪼개졌기 때문이다.
  // 014 로 세로 배치가 되면서 그 이유가 없어졌다 — 글자 블록이 자기 줄을 쓰므로
  // 내용 폭으로 줄여도 2줄을 유지한다. `w-full` 을 떼어 흰 배경이 글자를 감싸게 하고,
  // 화면이 아주 좁을 때만 `max-w-full` 로 넘치지 않게 막는다.
  // 좌우 여백도 px-3 → px-2.5 로 줄인다(대표 지시: "불필요한 양 옆 공백 제거").
  return (
    <div
      data-ui="freechat-daily-key-status"
      data-state={earned ? "earned" : "not-earned"}
      className="flex min-w-0 max-w-full flex-col items-center gap-1 rounded-2xl bg-white/80 px-2.5 py-1.5 shadow-sm backdrop-blur-md"
    >
      <span className="shrink-0 text-[15px]" aria-hidden="true">
        🔑
      </span>
      <span className="flex min-w-0 flex-col text-center leading-tight">
        <span className="text-[12px] font-bold break-keep text-[var(--color-k-navy)]">
          오늘의 황금열쇠
        </span>
        <span
          className={`text-[12px] font-bold break-keep ${earned ? "text-[#0E8A4F]" : "text-[#6B7280]"}`}
        >
          {earned ? "오늘 받았어! ✓" : "아직 안 받았어"}
        </span>
      </span>
    </div>
  );
}
