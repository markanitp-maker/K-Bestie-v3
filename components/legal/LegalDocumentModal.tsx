"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import type { LegalDocumentKey } from "@/lib/legal/types";
import { useLegalDocument } from "./LegalDocumentsProvider";
import { LegalDocumentView } from "./LegalDocumentView";

type LegalDocumentModalProps = {
  documentKey: LegalDocumentKey;
  open: boolean;
  onClose: () => void;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export const LegalDocumentModal = ({ documentKey, open, onClose }: LegalDocumentModalProps) => {
  const document = useLegalDocument(documentKey);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = globalThis.document.activeElement instanceof HTMLElement
      ? globalThis.document.activeElement
      : null;
    const previousOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    globalThis.document.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.document.removeEventListener("keydown", handleKeyDown);
      globalThis.document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-3 py-5 sm:px-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4">
          <div className="min-w-0">
            <h1 id={titleId} className="text-base font-extrabold leading-snug text-gray-900">
              {document?.title ?? "법률 문서"}
            </h1>
            {document && (
              <p className="mt-1 text-[11px] text-gray-500">
                버전 {document.version} · 시행예정일 {document.effectiveDate}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="문서 닫기"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {document ? (
            <LegalDocumentView document={document} compact />
          ) : (
            <p className="py-10 text-center text-sm text-gray-500">현재 공개 가능한 상세 문서가 없습니다.</p>
          )}
        </div>

        <footer className="sticky bottom-0 z-10 shrink-0 border-t border-gray-100 bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="mb-2 text-center text-[10px] leading-relaxed text-gray-400">
            상세 문서 확인은 동의로 처리되지 않습니다. 원래 화면의 체크박스를 직접 선택해 주세요.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 w-full rounded-2xl bg-[var(--color-k-navy)] text-sm font-extrabold text-white"
          >
            확인
          </button>
        </footer>
      </div>
    </div>
  );
};
