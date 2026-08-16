"use client";

import React, { useEffect, useRef, useState } from "react";
import { pwaUpdateCopy } from "../lib/pwa/updateFlow";

export interface PwaUpdateGateModalProps {
  isOpen: boolean;
  isUpdating: boolean;
  updateState?: "idle" | "mismatch" | "delayed" | "error" | "offline" | "reloading";
  onUpdate: () => void;
  onBlockedNavigation?: () => void;
  navigationWarning?: string | null;
}

export function PwaUpdateGateModal({
  isOpen,
  isUpdating,
  updateState = "mismatch",
  onUpdate,
  onBlockedNavigation,
  navigationWarning: externalNavWarning,
}: PwaUpdateGateModalProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [internalNavWarning, setInternalNavWarning] = useState<string | null>(null);

  const navWarning = externalNavWarning || internalNavWarning;

  // 1. Focus management, Body Scroll Lock, and App Siblings inert / aria-hidden restoration
  useEffect(() => {
    if (!isOpen) return;

    // Record previous active element for focus restoration on unmount
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    // Body scroll lock
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Initial focus on update button or modal container
    if (buttonRef.current && !buttonRef.current.disabled) {
      buttonRef.current.focus();
    } else if (modalRef.current) {
      modalRef.current.focus();
    }

    // App siblings inert / aria-hidden restoration
    const siblingsToRestore: Array<{
      el: HTMLElement;
      prevAriaHidden: string | null;
      prevInert: boolean;
    }> = [];

    if (typeof document !== "undefined" && modalRef.current) {
      const rootContainer =
        modalRef.current.closest("[data-testid='pwa-update-gate-overlay']") || modalRef.current;
      const bodyChildren = Array.from(document.body.children) as HTMLElement[];
      for (const child of bodyChildren) {
        if (child !== rootContainer && !child.contains(rootContainer)) {
          const prevAriaHidden = child.getAttribute("aria-hidden");
          const prevInert = child.hasAttribute("inert");
          child.setAttribute("aria-hidden", "true");
          child.setAttribute("inert", "");
          siblingsToRestore.push({ el: child, prevAriaHidden, prevInert });
        }
      }
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      for (const { el, prevAriaHidden, prevInert } of siblingsToRestore) {
        if (prevAriaHidden !== null) {
          el.setAttribute("aria-hidden", prevAriaHidden);
        } else {
          el.removeAttribute("aria-hidden");
        }
        if (!prevInert) {
          el.removeAttribute("inert");
        }
      }
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === "function") {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  // 2. Focusin Recapture to maintain focus inside modal
  useEffect(() => {
    if (!isOpen) return;

    const handleFocusIn = (e: FocusEvent) => {
      if (!modalRef.current) return;
      if (e.target instanceof Node && !modalRef.current.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        if (buttonRef.current && !buttonRef.current.disabled) {
          buttonRef.current.focus();
        } else if (modalRef.current) {
          modalRef.current.focus();
        }
      }
    };

    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [isOpen]);

  // 3. Keyboard Focus Trap & Escape Key Interception
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setInternalNavWarning("업데이트를 진행해 주세요.");
        return;
      }

      if (e.key === "Tab") {
        if (!modalRef.current) return;
        const focusables = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) {
          e.preventDefault();
          modalRef.current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  // 4. Navigation Click & Submit Capture Interception
  useEffect(() => {
    if (!isOpen) return;

    const handleCaptureClick = (e: MouseEvent) => {
      if (!modalRef.current) return;

      // Allow clicks inside modal (e.g. update button)
      if (modalRef.current.contains(e.target as Node)) {
        return;
      }

      // Block all clicks outside modal
      e.preventDefault();
      e.stopPropagation();

      setInternalNavWarning("업데이트를 진행해 주세요.");

      // If clicked element is a navigation target, notify callback
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.closest(
          'a[href], button, [role="button"], input[type="submit"], [data-navigation]'
        )
      ) {
        onBlockedNavigation?.();
      }
    };

    const handleCaptureSubmit = (e: SubmitEvent) => {
      if (!modalRef.current) return;
      if (modalRef.current.contains(e.target as Node)) return;

      e.preventDefault();
      e.stopPropagation();
      setInternalNavWarning("업데이트를 진행해 주세요.");
      onBlockedNavigation?.();
    };

    window.addEventListener("click", handleCaptureClick, true);
    window.addEventListener("submit", handleCaptureSubmit, true);
    return () => {
      window.removeEventListener("click", handleCaptureClick, true);
      window.removeEventListener("submit", handleCaptureSubmit, true);
    };
  }, [isOpen, onBlockedNavigation]);

  if (!isOpen) return null;

  const copyState =
    updateState === "idle" || updateState === "reloading" ? "mismatch" : updateState;
  const copy = pwaUpdateCopy(copyState);
  const buttonText = isUpdating
    ? "업데이트 진행 중..."
    : updateState === "delayed" || updateState === "error" || updateState === "offline"
    ? "다시 업데이트"
    : copy.action || "업데이트";

  return (
    <div
      data-testid="pwa-update-gate-overlay"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none pointer-events-auto"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setInternalNavWarning("업데이트를 진행해 주세요.");
      }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pwa-update-title"
        aria-describedby="pwa-update-desc"
        data-testid="pwa-update-gate-modal"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 text-center transform transition-all focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <h2
            id="pwa-update-title"
            data-testid="pwa-update-title"
            className="text-xl font-bold text-[var(--color-k-navy,#1e293b)] leading-snug"
          >
            {copy.title}
          </h2>
          <p
            id="pwa-update-desc"
            data-testid="pwa-update-desc"
            className="text-sm text-gray-600 leading-relaxed break-keep"
          >
            {copy.body}
          </p>
        </div>

        {navWarning && (
          <div
            role="alert"
            aria-live="assertive"
            data-testid="pwa-update-nav-warning"
            className="text-xs font-semibold text-amber-600 bg-amber-50 rounded-lg p-2 border border-amber-200"
          >
            {navWarning}
          </div>
        )}

        <button
          ref={buttonRef}
          type="button"
          data-testid="pwa-update-button"
          disabled={isUpdating}
          onClick={onUpdate}
          className="w-full mt-2 py-3 px-4 bg-[var(--color-k-orange,#f97316)] hover:bg-orange-600 disabled:opacity-50 text-white text-base font-bold rounded-xl shadow-md transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}
