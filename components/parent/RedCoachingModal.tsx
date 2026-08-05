"use client";

import { useEffect } from "react";

// requests/request-parent-query-router-grade4-v1.md §7.2/§9.2/§9.3 — Red/Crisis 판정은
// 초안 모달로 보내지 않고, 부모에게 코칭 문구와(있으면) 안전한 대안 1개를 보여준다.
// 대안은 자동 등록하지 않고 부모가 "안전한 질문으로 바꾸기"를 눌러야만 별도 확인 모달로
// 넘어간다. Crisis는 안전 대안 자체를 제공하지 않는다(§8.2).

export interface RedCoachingModalProps {
  variant: "RED" | "CRISIS";
  coachingText: string;
  safeAlternativeText: string | null; // 대안의 부모 확인용 문구(있을 때만)
  onClose: () => void;
  onUseSafeAlternative: (() => void) | null;
}

export function RedCoachingModal({ variant, coachingText, safeAlternativeText, onClose, onUseSafeAlternative }: RedCoachingModalProps) {
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const title = variant === "CRISIS" ? "이 질문은 케이가 대신 전달할 수 없어요" : "이 질문은 케이가 아이에게 대신 묻지 않아요";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4 bg-black/40 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="red-coaching-modal-title"
    >
      <div
        className="w-full max-h-[85dvh] sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden outline-none"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0 border-b border-gray-100">
          <h2 id="red-coaching-modal-title" className="text-base font-bold text-gray-900">
            {title}
          </h2>
          <button onClick={onClose} aria-label="닫기" className="p-2 -mr-2 text-gray-400 hover:bg-gray-100 rounded-full">
            ✕
          </button>
        </div>

        <div className="px-5 py-4 flex-1 overflow-y-auto flex flex-col gap-4">
          <p className="text-sm text-gray-700 leading-relaxed">{coachingText}</p>

          {safeAlternativeText && (
            <div className="rounded-xl p-3" style={{ background: "#f9fafb" }}>
              <p className="text-xs text-gray-500 mb-1.5">대신 아래처럼 부담 없는 질문은 사용할 수 있어요</p>
              <p className="text-sm font-bold text-gray-900">{safeAlternativeText}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 flex gap-2 shrink-0 border-t border-gray-100">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold rounded-xl bg-gray-100 text-gray-600">
            닫기
          </button>
          {safeAlternativeText && onUseSafeAlternative && (
            <button
              onClick={onUseSafeAlternative}
              className="flex-1 py-3 text-sm font-bold rounded-xl text-white"
              style={{ background: "var(--color-k-navy)" }}
            >
              안전한 질문으로 바꾸기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
