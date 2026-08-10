"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useStore } from "@/hooks/useStore";
import { setStore } from "@/lib/store";
import { useNotificationInbox } from "@/lib/notifications/useNotificationInbox";

interface ParentHomeHeaderProps {
  onStartChild?: () => void;
}

export function ParentHomeHeader({ onStartChild }: ParentHomeHeaderProps) {
  const store = useStore();
  const { children, activeChildId } = store;
  const { unreadCount } = useNotificationInbox({ loadItems: false });
  const [showPicker, setShowPicker] = useState(false);

  const activeChild = children.find((c) => c.id === activeChildId) ?? children[0] ?? null;

  const handleSelect = (id: string) => {
    setStore({ activeChildId: id });
    if (typeof window !== "undefined") localStorage.setItem("k_child_id", id);
    setShowPicker(false);
  };

  return (
    <div
      className="shrink-0 flex items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-4 sticky top-0 z-30"
      style={{ background: "var(--color-k-surface, #ffffff)" }}
    >
      <div className="flex min-w-0 shrink">
        <Image
          src="/Images/logo/Logo.png"
          alt="내친구 케이"
          width={84}
          height={24}
          className="h-auto w-[72px] object-contain sm:w-[84px]"
          priority
        />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        {onStartChild && activeChild && (
          <button
            type="button"
            onClick={onStartChild}
            className="min-h-11 whitespace-nowrap rounded-xl bg-[var(--color-k-orange)] px-2.5 text-[13px] font-extrabold text-white shadow-[0_3px_8px_rgba(232,112,42,0.24)] transition-colors hover:brightness-95 active:brightness-90 sm:px-3.5 sm:text-sm"
          >
            아이 시작하기
          </button>
        )}
        {activeChild && (
          <div className="relative">
            <button
              onClick={() => { if (children.length > 1) setShowPicker((v) => !v); }}
              className={`flex max-w-[58px] items-center gap-1 truncate text-[13px] font-bold sm:max-w-[88px] ${children.length > 1 ? "cursor-pointer" : ""}`}
              style={{ color: "var(--color-k-text-primary, #111827)" }}
              aria-label={children.length > 1 ? "자녀 선택" : undefined}
              aria-expanded={children.length > 1 ? showPicker : undefined}
              aria-haspopup={children.length > 1 ? "listbox" : undefined}
            >
              <span className="truncate">{activeChild.name}</span>
              {children.length > 1 ? (
                <span className="text-[10px]" style={{ color: "#6b7280" }}>{showPicker ? '▲' : '▼'}</span>
              ) : (
                <span className="text-[10px]" style={{ color: "#6b7280" }}>▼</span>
              )}
            </button>

            {showPicker && children.length > 1 && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} aria-hidden="true" />
                <div className="absolute right-0 top-full mt-1.5 z-50 w-max min-w-[110px] bg-white rounded-xl shadow-lg border border-gray-100 p-1 flex flex-col gap-0.5" role="listbox">
                  {children.map((c) => {
                    const isSelected = c.id === activeChild?.id;
                    return (
                      <button
                        key={c.id}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelect(c.id)}
                        className={`w-full flex items-center px-2.5 py-1.5 rounded-lg text-[13px] font-bold cursor-pointer whitespace-nowrap ${
                          isSelected ? "bg-[#fdf1ec] text-[#E25B12]" : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <span className="mr-1" aria-hidden="true">🧒</span> {c.name}
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
          className="relative flex h-11 w-11 items-center justify-center text-lg cursor-pointer"
          aria-label={unreadCount > 0 ? `알림 ${unreadCount}개` : "알림 없음"}
        >
          <span className="text-[20px]" style={{ color: "var(--color-k-navy, #10315B)" }}>🔔</span>
          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 min-w-5 h-5 px-1 bg-[#E25B12] text-white text-[10px] font-bold rounded-full border-2 border-white flex items-center justify-center">{unreadCount > 99 ? "99+" : unreadCount}</span>
          )}
        </Link>
      </div>
    </div>
  );
}
