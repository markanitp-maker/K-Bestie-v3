"use client";

// 요청서 012 §3-1 — 부모 홈 키/몸무게 카드.
//
// 기존 InsightGrid 8개 대화 인사이트 카드는 그대로 두고 신규 카드만 추가한다.
// 카드를 처음 누르면 성장정보 최초 설정(동의+생년월일), 설정 후에는 성장 상세를 연다.

import { useCallback, useEffect, useState } from "react";
import { Ruler, Scale } from "lucide-react";

import type { GrowthStateResponse } from "@/lib/growth/types";
import { GrowthSetupModal } from "@/components/parent/growth/GrowthSetupModal";
import { GrowthDetailModal } from "@/components/parent/growth/GrowthDetailModal";

interface Props {
  childId: string | null;
  childName: string;
}

export function GrowthCards({ childId, childName }: Props) {
  const [state, setState] = useState<GrowthStateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<"none" | "setup" | "detail">("none");

  const loadState = useCallback(async (targetChildId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/parent/growth/${encodeURIComponent(targetChildId)}`);
      if (!response.ok) {
        setState(null);
        return;
      }
      setState((await response.json()) as GrowthStateResponse);
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setModal("none");
    setState(null);
    if (childId) void loadState(childId);
  }, [childId, loadState]);

  if (!childId) return null;

  const latestHeight = state?.summary?.latestHeight ?? null;
  const latestWeight = state?.summary?.latestWeight ?? null;

  const openCard = () => {
    if (!state) return;
    setModal(state.configured ? "detail" : "setup");
  };

  // 대표님 지정 UI(요청서 012.png): 흰 카드 + 좌측 컬러 바 + 아이콘 배지.
  // 키는 골드, 몸무게는 틸로 구분한다. 색은 globals.css 디자인 토큰만 참조한다.
  const cards = [
    {
      key: "height",
      title: "키",
      value: latestHeight ? `${latestHeight.evaluation.value.toFixed(1)}cm` : "기록 없음",
      measuredAt: latestHeight?.measuredAt ?? null,
      accent: "var(--color-k-growth-height)",
      Icon: Ruler,
    },
    {
      key: "weight",
      title: "몸무게",
      value: latestWeight ? `${latestWeight.evaluation.value.toFixed(1)}kg` : "기록 없음",
      measuredAt: latestWeight?.measuredAt ?? null,
      accent: "var(--color-k-growth-weight)",
      Icon: Scale,
    },
  ];

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-x-3 gap-y-2.5 sm:gap-4">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={openCard}
            disabled={loading || !state}
            aria-label={`${childName} ${card.title} 성장정보 열기`}
            className="relative min-h-[92px] overflow-hidden rounded-[18px] border border-[#10315B]/20 bg-white px-4 py-3 pl-5 text-left shadow-sm transition-transform active:scale-[0.98] disabled:opacity-60 sm:min-h-[104px] sm:p-5 sm:pl-6"
          >
            <span
              aria-hidden="true"
              className="absolute left-0 top-0 h-full w-[6px]"
              style={{ backgroundColor: card.accent }}
            />
            <span className="flex items-center gap-1.5">
              <span className="text-[13px] font-bold text-[var(--color-k-navy)]">{card.title}</span>
              <span
                aria-hidden="true"
                className="flex h-[22px] w-[22px] items-center justify-center rounded-full"
                style={{ backgroundColor: card.accent }}
              >
                <card.Icon className="h-[13px] w-[13px] text-white" strokeWidth={2.5} />
              </span>
            </span>
            <span className="mt-0.5 block text-[24px] font-bold leading-tight text-[var(--color-k-navy)] sm:text-[26px]">
              {loading && !state ? "…" : card.value}
            </span>
            <span className="mt-1 block text-[12px] font-semibold text-[var(--color-k-text-secondary)]">
              {card.measuredAt ?? (state?.configured ? "측정값을 입력해 주세요" : "시작하려면 눌러주세요")}
            </span>
          </button>
        ))}
      </div>

      {modal === "setup" && state && (
        <GrowthSetupModal
          childId={childId}
          childName={childName || state.childName || "아이"}
          currentGender={state.gender}
          onClose={() => setModal("none")}
          onCompleted={(next) => {
            setState(next);
            setModal("detail");
          }}
        />
      )}

      {modal === "detail" && state && (
        <GrowthDetailModal
          childId={childId}
          state={state}
          onClose={() => setModal("none")}
          onStateChange={setState}
        />
      )}
    </>
  );
}
