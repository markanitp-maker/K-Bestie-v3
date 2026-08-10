"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useStore } from "@/hooks/useStore";
import { setStore } from "@/lib/store";
import { ChildStartGuideModal } from "@/components/parent/ChildStartGuide";

interface ParentHeaderProps {
  onStartChild?: () => void;
}

// 모든 부모 화면(홈/리포트/케이와 대화/설정)에 고정으로 들어가는 상단 헤더.
// 로고(좌측) + 화면 중앙 CTA + 현재 선택된 아이 이름·알림(우측).
// 아이 선택은 store.activeChildId(+localStorage k_child_id)에 반영되어
// 다른 화면(리포트/케이와 대화/설정)이 그 아이 기준으로 동작하게 한다.
export function ParentHeader({ onStartChild }: ParentHeaderProps) {
  const store = useStore();
  const { children, activeChildId } = store;
  const [showPicker, setShowPicker] = useState(false);
  const [showChildStartGuide, setShowChildStartGuide] = useState(false);

  const activeChild = children.find((c) => c.id === activeChildId) ?? children[0] ?? null;

  const handleSelect = (id: string) => {
    setStore({ activeChildId: id });
    if (typeof window !== "undefined") localStorage.setItem("k_child_id", id);
    setShowPicker(false);
  };

  const handleStartChild = () => {
    if (onStartChild) {
      onStartChild();
      return;
    }
    setShowChildStartGuide(true);
  };

  return (
    <>
      <div
        className="sticky top-0 z-30 flex shrink-0 items-center gap-2 px-3 py-3 sm:px-4 sm:py-4"
        style={{ background: "var(--color-k-surface)" }}
      >
        <Link href="/parent/home" className="min-w-0 shrink cursor-pointer">
          <Image
            src="/Images/logo/Logo.png"
            alt="내친구 케이"
            width={84}
            height={24}
            className="h-auto w-[72px] object-contain sm:w-[84px]"
            priority
          />
        </Link>

        {activeChild && (
          <button
            type="button"
            onClick={handleStartChild}
            className="absolute left-1/2 min-h-11 -translate-x-1/2 whitespace-nowrap rounded-xl bg-[var(--color-k-orange)] px-2.5 text-[13px] font-extrabold text-white shadow-[0_3px_8px_rgba(232,112,42,0.24)] transition-colors hover:brightness-95 active:brightness-90 sm:px-3.5 sm:text-sm"
          >
            아이 시작하기
          </button>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
          {activeChild && (
            <div className="relative">
              <button
                onClick={() => { if (children.length > 1) setShowPicker((v) => !v); }}
                className={`flex max-w-[58px] items-center gap-1 text-[13px] font-bold sm:max-w-[88px] ${children.length > 1 ? "cursor-pointer" : ""}`}
                style={{ color: "var(--color-k-text-primary)" }}
                aria-label={children.length > 1 ? "자녀 선택" : undefined}
                aria-expanded={children.length > 1 ? showPicker : undefined}
                aria-haspopup={children.length > 1 ? "listbox" : undefined}
              >
                <span className="truncate">{activeChild.name}</span>
                <span className="text-[10px]" style={{ color: "#6b7280" }}>{children.length > 1 && showPicker ? "▲" : "▼"}</span>
              </button>

              {showPicker && children.length > 1 && (
                <>
                  {/* 바깥 클릭 시 닫기 — 배경 딤 처리는 하지 않음(드롭다운이므로) */}
                  <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} aria-hidden="true" />
                  <div className="absolute right-0 top-full z-50 mt-1.5 flex w-max min-w-[110px] flex-col gap-0.5 rounded-xl border border-gray-100 bg-white p-1 shadow-lg" role="listbox">
                    {children.map((c) => {
                      const isSelected = c.id === activeChild?.id;
                      return (
                        <button
                          key={c.id}
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelect(c.id)}
                          className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-[13px] font-bold whitespace-nowrap ${
                            isSelected ? "bg-[#fdf1ec] text-[var(--color-k-orange)]" : "text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          <span>🧒 {c.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          <Link
            href="/parent/notifications"
            className="flex h-11 w-11 items-center justify-center text-lg cursor-pointer"
            aria-label="알림"
          >
            🔔
          </Link>
        </div>
      </div>
      {!onStartChild && (
        <ChildStartGuideModal
          open={showChildStartGuide}
          onClose={() => setShowChildStartGuide(false)}
          children={children}
        />
      )}
    </>
  );
}
