"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useStore } from "@/hooks/useStore";
import { setStore } from "@/lib/store";

export function ParentHomeHeader() {
  const store = useStore();
  const { children, activeChildId, notifications } = store;
  const [showPicker, setShowPicker] = useState(false);

  const activeChild = children.find((c) => c.id === activeChildId) ?? children[0] ?? null;
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleSelect = (id: string) => {
    setStore({ activeChildId: id });
    if (typeof window !== "undefined") localStorage.setItem("k_child_id", id);
    setShowPicker(false);
  };

  return (
    <div
      className="shrink-0 flex items-center justify-between px-4 py-4 sticky top-0 z-30"
      style={{ background: "var(--color-k-surface, #ffffff)" }}
    >
      <div className="flex items-center">
        <Image
          src="/Images/logo/Logo.png"
          alt="내친구 케이"
          width={84}
          height={24}
          className="object-contain"
          priority
        />
      </div>
      <div className="flex items-center gap-3">
        {activeChild && (
          <div className="relative">
            <button
              onClick={() => { if (children.length > 1) setShowPicker((v) => !v); }}
              className={`flex items-center gap-1 text-[13px] font-bold ${children.length > 1 ? "cursor-pointer" : ""}`}
              style={{ color: "var(--color-k-text-primary, #111827)" }}
              aria-label={children.length > 1 ? "자녀 선택" : undefined}
              aria-expanded={children.length > 1 ? showPicker : undefined}
              aria-haspopup={children.length > 1 ? "listbox" : undefined}
            >
              {activeChild.name}
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
          className="relative text-lg cursor-pointer flex items-center justify-center w-[44px] h-[44px]" 
          aria-label={unreadCount > 0 ? `알림 ${unreadCount}개` : "알림 없음"}
        >
          <span className="text-[20px]" style={{ color: "var(--color-k-navy, #10315B)" }}>🔔</span>
          {unreadCount > 0 && (
            <span className="absolute top-2 right-2 w-2 h-2 bg-[#E25B12] rounded-full border-2 border-white" />
          )}
        </Link>
      </div>
    </div>
  );
}
