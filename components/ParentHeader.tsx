"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useStore } from "@/hooks/useStore";
import { setStore } from "@/lib/store";


// 모든 부모 화면(홈/리포트/케이와 대화/설정)에 고정으로 들어가는 상단 헤더.
// 로고(좌측) + 현재 선택된 아이 이름(우측, 클릭 시 아이 선택 목록) + 알림 버튼.
// 아이 선택은 store.activeChildId(+localStorage k_child_id)에 반영되어
// 다른 화면(리포트/케이와 대화/설정)이 그 아이 기준으로 동작하게 한다.
export function ParentHeader() {
  const store = useStore();
  const { children, activeChildId } = store;
  const [showPicker, setShowPicker] = useState(false);

  const activeChild = children.find((c) => c.id === activeChildId) ?? children[0] ?? null;

  const handleSelect = (id: string) => {
    setStore({ activeChildId: id });
    if (typeof window !== "undefined") localStorage.setItem("k_child_id", id);
    setShowPicker(false);
  };

  return (
    <>
      <div
        className="shrink-0 flex items-center justify-between px-4 py-4"
        style={{ background: "var(--color-k-surface)" }}
      >
        <Link href="/parent/home" className="cursor-pointer">
          <Image
            src="/Images/logo/Logo.png"
            alt="내친구 케이"
            width={84}
            height={24}
            className="object-contain"
            priority
          />
        </Link>
        <div className="flex items-center gap-3">
          {activeChild && (
            <div className="relative">
              <button
                onClick={() => { if (children.length > 1) setShowPicker((v) => !v); }}
                className={`flex items-center gap-1 text-xs font-bold ${children.length > 1 ? "cursor-pointer" : ""}`}
                style={{ color: "var(--color-k-text-primary)" }}
              >
                {activeChild.name}
                {children.length > 1 && <span className="text-[9px]" style={{ color: "#6b7280" }}>▾</span>}
              </button>

              {showPicker && (
                <>
                  {/* 바깥 클릭 시 닫기 — 배경 딤 처리는 하지 않음(드롭다운이므로) */}
                  <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-50 w-max min-w-[110px] bg-white rounded-xl shadow-lg border border-gray-100 p-1 flex flex-col gap-0.5">
                    {children.map((c) => {
                      const isSelected = c.id === activeChild?.id;
                      return (
                        <button
                          key={c.id}
                          onClick={() => handleSelect(c.id)}
                          className={`w-full flex items-center px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${
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
          <Link href="/parent/notifications" className="text-lg cursor-pointer" aria-label="알림">
            🔔
          </Link>
        </div>
      </div>
    </>
  );
}
