"use client";

import { useRef } from "react";

interface GoldKeyRewardModalProps {
  open: boolean;
  title: string;
  description: string;
  awarded: boolean;
  onClose: () => void;
  idPrefix?: string;
}

export function GoldKeyRewardModal({
  open,
  title,
  description,
  awarded,
  onClose,
  idPrefix = "gold-key-reward",
}: GoldKeyRewardModalProps) {
  const closeXButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  if (!open) return null;

  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        event.preventDefault();
        const isOnXButton = document.activeElement === closeXButtonRef.current;
        const target = isOnXButton ? closeButtonRef.current : closeXButtonRef.current;
        target?.focus();
      }}
    >
      <div
        className="w-[90%] max-w-[340px] bg-white rounded-[24px] shadow-lg p-6 flex flex-col items-center relative overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeXButtonRef}
          onClick={onClose}
          aria-label="보상 화면 닫기"
          className="absolute top-4 right-4 w-[44px] h-[44px] flex items-center justify-center rounded-full hover:bg-gray-100 active:scale-95 text-gray-500 cursor-pointer"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div
          data-gold-key-reward-animated
          className="w-[90px] h-[90px] mt-2 mb-4 bg-yellow-50 rounded-full flex items-center justify-center text-[48px]"
          style={{ animation: "goldKeyRewardScaleIn 0.35s ease-out forwards" }}
          aria-hidden="true"
        >
          🔑
        </div>

        <h2
          data-gold-key-reward-animated
          id={titleId}
          className="text-[24px] font-extrabold text-[var(--color-k-navy)] mb-1 text-center"
          style={{ animation: "goldKeyRewardSlideUp 0.35s ease-out forwards" }}
        >
          {title}
          {awarded && (
            <>
              <span className="sr-only"> 황금열쇠 1개 획득.</span>
              <span aria-hidden="true" className="ml-1" style={{ color: "var(--color-k-orange)" }}>
                +1
              </span>
            </>
          )}
        </h2>

        <p
          data-gold-key-reward-animated
          id={descriptionId}
          className="text-gray-500 font-medium text-[15px] mb-8 text-center"
          style={{ animation: "goldKeyRewardSlideUp 0.4s ease-out forwards" }}
        >
          {description}
        </p>

        <button
          ref={closeButtonRef}
          autoFocus
          onClick={onClose}
          className="w-full max-w-[140px] h-[48px] rounded-full text-white font-bold text-[16px] shadow-sm active:scale-95 transition-transform cursor-pointer"
          style={{ backgroundColor: "var(--color-k-navy)" }}
        >
          닫기
        </button>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes goldKeyRewardScaleIn {
          from { transform: scale(0.85); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes goldKeyRewardSlideUp {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-gold-key-reward-animated] { animation: none !important; }
        }
      ` }} />
    </div>
  );
}
