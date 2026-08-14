"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";

export interface LandingSupportInquiryModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*\.[a-zA-Z]{2,}$/;
const MAX_CONTENT_LENGTH = 2000;

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getSafeDeviceInfo() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return null;
  }
  return {
    userAgent: navigator.userAgent || "unknown",
    platform: navigator.platform || "unknown",
    language: navigator.language || "unknown",
    isMobile: /Mobi|Android/i.test(navigator.userAgent || ""),
  };
}

export default function LandingSupportInquiryModal({
  isOpen,
  onClose,
  triggerRef,
}: LandingSupportInquiryModalProps) {
  const [email, setEmail] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successRequestNumber, setSuccessRequestNumber] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const idempotencyKeyRef = useRef<string>(generateUUID());
  const prevIsOpenRef = useRef(false);

  const resetAllFormState = useCallback(() => {
    setEmail("");
    setContent("");
    setErrorMessage(null);
    setSuccessRequestNumber(null);
    idempotencyKeyRef.current = generateUUID();
  }, []);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    resetAllFormState();
    onClose();
  }, [isSubmitting, resetAllFormState, onClose]);

  // When modal transitions between open and closed
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      previousActiveElementRef.current = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;
      idempotencyKeyRef.current = generateUUID();
      setEmail("");
      setContent("");
      setErrorMessage(null);
      setSuccessRequestNumber(null);
    } else if (!isOpen && prevIsOpenRef.current) {
      resetAllFormState();
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, resetAllFormState]);

  // Focus trap & Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (!isSubmitting) {
          handleClose();
        }
        return;
      }

      if (e.key === "Tab") {
        if (!modalRef.current) return;
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input[type="text"]:not([disabled]), input[type="email"]:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || document.activeElement === modalRef.current) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    },
    [isOpen, isSubmitting, handleClose]
  );

  // Body scroll lock & focus management
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleKeyDown);

      const focusTimer = setTimeout(() => {
        if (emailInputRef.current && !successRequestNumber) {
          emailInputRef.current.focus();
        } else if (modalRef.current) {
          modalRef.current.focus();
        }
      }, 50);

      return () => {
        clearTimeout(focusTimer);
        document.body.style.overflow = originalOverflow;
        document.removeEventListener("keydown", handleKeyDown);
      };
    } else {
      if (triggerRef?.current) {
        triggerRef.current.focus();
      } else if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    }
  }, [isOpen, handleKeyDown, triggerRef, successRequestNumber]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    const trimmedContent = content.trim();

    if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
      setErrorMessage("올바른 이메일 주소를 입력해 주세요.");
      emailInputRef.current?.focus();
      return;
    }

    if (trimmedContent.length < 2) {
      setErrorMessage("문의 내용을 2자 이상 입력해 주세요.");
      return;
    }

    if (trimmedContent.length > MAX_CONTENT_LENGTH) {
      setErrorMessage("문의 내용은 2,000자 이내로 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const payload = {
      app_surface: "landing",
      contact_email: trimmedEmail,
      content: trimmedContent,
      current_route: typeof window !== "undefined" ? window.location.pathname : "/",
      app_version: process.env.NEXT_PUBLIC_APP_VERSION || "unknown",
      device_info: getSafeDeviceInfo(),
      idempotency_key: idempotencyKeyRef.current,
    };

    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        request_number?: string;
        error?: string;
      };

      if (response.ok && data.ok && data.request_number) {
        setSuccessRequestNumber(data.request_number);
        setErrorMessage(null);
      } else if (response.status === 429) {
        setErrorMessage("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
      } else if (response.status === 400) {
        setErrorMessage("이메일 형식과 문의 내용을 확인해 주세요.");
      } else if (response.status === 413) {
        setErrorMessage("문의 내용이 너무 깁니다. 내용을 줄여서 다시 시도해 주세요.");
      } else {
        setErrorMessage("문의를 접수하지 못했습니다.\n작성한 내용은 유지되니 잠시 후 다시 시도해 주세요.");
      }
    } catch {
      setErrorMessage("문의를 접수하지 못했습니다.\n작성한 내용은 유지되니 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          handleClose();
        }
      }}
      aria-hidden={!isOpen}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="landing-support-modal-title"
        tabIndex={-1}
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl focus:outline-none"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h2 id="landing-support-modal-title" className="text-xl font-extrabold text-[var(--color-k-navy)]">
              문의하기
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 sm:text-sm">
              내친구 케이 이용에 궁금한 점이 있으시면 남겨주세요.
              <br />
              확인 후 입력하신 이메일로 안내드리겠습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {successRequestNumber ? (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-[var(--color-k-navy)]">
                문의가 접수되었습니다.
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                확인 후 입력하신 이메일로 안내드리겠습니다.
              </p>

              <div className="mt-6 w-full rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                <p className="text-xs font-bold tracking-wider text-slate-500">접수번호</p>
                <p className="mt-1 text-base font-extrabold tracking-widest text-[var(--color-k-navy)] sm:text-lg">
                  {successRequestNumber}
                </p>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--color-k-navy)] px-6 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-k-navy)]"
              >
                확인
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {errorMessage && (
                <div
                  role="alert"
                  className="whitespace-pre-line rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold leading-relaxed text-rose-700 sm:text-sm"
                >
                  {errorMessage}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="landing-inquiry-email" className="text-xs font-bold text-slate-700 sm:text-sm">
                  이메일 <span className="text-[var(--color-k-orange)]">*</span>
                </label>
                <input
                  ref={emailInputRef}
                  id="landing-inquiry-email"
                  type="email"
                  required
                  placeholder="답변받을 이메일을 입력해 주세요."
                  value={email}
                  disabled={isSubmitting}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="landing-inquiry-content" className="text-xs font-bold text-slate-700 sm:text-sm">
                    문의 내용 <span className="text-[var(--color-k-orange)]">*</span>
                  </label>
                  <span className={`text-xs ${content.length > MAX_CONTENT_LENGTH ? "font-bold text-rose-600" : "text-slate-400"}`}>
                    {content.length} / {MAX_CONTENT_LENGTH}자
                  </span>
                </div>
                <textarea
                  id="landing-inquiry-content"
                  required
                  rows={5}
                  maxLength={MAX_CONTENT_LENGTH}
                  placeholder="궁금한 내용을 입력해 주세요."
                  value={content}
                  disabled={isSubmitting}
                  onChange={(e) => {
                    setContent(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  className="w-full resize-none rounded-xl border border-slate-300 bg-white p-3.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <div className="mt-2 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !email.trim() || content.trim().length < 2 || content.length > MAX_CONTENT_LENGTH}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--color-k-orange)] px-6 text-sm font-extrabold text-[var(--color-k-navy)] shadow-[0_4px_14px_rgba(226,91,18,0.2)] transition hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-k-navy)] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>접수 중...</span>
                    </>
                  ) : (
                    "제출하기"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
