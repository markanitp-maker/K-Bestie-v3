"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface KChatbotWidgetProps {
  appSurface: "child" | "parent";
  /** 이 화면 하단에 이미 절대/고정 위치 컨트롤(마이크·음성 버튼 바 등)이 있어 기본
   *  위치(하단 16px)와 겹치는 경우, 그 컨트롤 높이만큼 더 띄우기 위한 오프셋(px).
   *  지정하지 않으면 기본값(16px + safe-area)을 그대로 쓴다. */
  bottomOffsetPx?: number;
}

type Category = "voc" | "feature" | "bug";

export default function KChatbotWidget({ appSurface, bottomOffsetPx = 16 }: KChatbotWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<Category>("voc");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const pathname = usePathname();
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 모달을 열 때(또는 제출 성공 후 폼 리셋 시) 1회 생성해, 같은 제출 시도(연타/네트워크
  // 재시도) 동안은 같은 값을 재사용한다 - 서버가 이 값에 유니크 제약을 걸어 중복 저장을
  // DB 레벨에서 막는다(app/api/support/route.ts 참고).
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  // Focus trap & Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === "Escape") {
      closeModal();
    } else if (e.key === "Tab") {
      if (!modalRef.current) return;
      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleKeyDown);
      // Focus first element
      setTimeout(() => {
        const firstInput = modalRef.current?.querySelector<HTMLElement>('input, textarea, button');
        firstInput?.focus();
      }, 50);
    } else {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    }
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const closeModal = () => {
    if (content.trim() !== "" || subject.trim() !== "") {
      if (!confirm(appSurface === "child" ? "작성하던 내용이 사라져. 정말 닫을까?" : "작성 중인 내용이 삭제됩니다. 정말 닫으시겠습니까?")) {
        return;
      }
    }
    setIsOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setCategory("voc");
    setSubject("");
    setContent("");
    setResultMessage(null);
    // 다음번 제출은 완전히 새 시도이므로 새 idempotency key를 발급한다(이번 제출과
    // 겹치지 않게). 실패 후 재시도(폼 유지, resetForm 미호출)는 기존 값을 그대로 써서
    // 서버가 같은 시도로 인식하도록 한다.
    idempotencyKeyRef.current = crypto.randomUUID();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (category !== "voc" && subject.trim().length < 2) {
      alert(appSurface === "child" ? "제목을 2글자 이상 적어줘!" : "제목을 2자 이상 입력해 주세요.");
      return;
    }
    if (content.trim().length < 2) {
      alert(appSurface === "child" ? "내용을 2글자 이상 적어줘!" : "내용을 2자 이상 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    setResultMessage(null);

    const deviceInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      isMobile: /Mobi|Android/i.test(navigator.userAgent),
    };

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subject: category === "voc" ? "" : subject,
          content,
          current_route: pathname,
          app_surface: appSurface,
          app_version: process.env.NEXT_PUBLIC_APP_VERSION || "unknown",
          device_info: deviceInfo,
          idempotency_key: idempotencyKeyRef.current,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed");
      }

      setResultMessage({
        type: "success",
        text: appSurface === "child"
          ? `케이에게 잘 전달했어! 접수번호는 ${data.request_number}야.`
          : `정상적으로 접수되었습니다. 접수번호는 ${data.request_number}입니다.`,
      });
      setSubject("");
      setContent("");
    } catch (err) {
      console.error(err);
      setResultMessage({
        type: "error",
        text: appSurface === "child"
          ? "접수하지 못했어. 작성한 내용은 그대로 있으니 잠시 후 다시 시도해줘."
          : "접수하지 못했습니다. 작성한 내용은 유지되니 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(true)}
        className="fixed left-4 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg text-white transition-colors"
        style={{ background: "var(--color-k-navy)", bottom: `calc(${bottomOffsetPx}px + env(safe-area-inset-bottom))` }}
        aria-label="케이 챗봇 피드백 접수 열기"
      >
        <span className="text-xl leading-none">💬</span>
        <span className="font-bold whitespace-nowrap">케이 챗봇</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="absolute inset-0" onClick={closeModal} />
          
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className="relative bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh] overflow-hidden"
          >
            <div className="flex justify-between items-center p-5 border-b">
              <div>
                <h2 id="modal-title" className="text-xl font-bold text-gray-900">
                  케이에게 알려주세요
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {appSurface === "child"
                    ? "궁금한 점이나 불편한 점, 케이에게 바라는 점을 알려줘!"
                    : "서비스 이용 중 문의사항, 건의사항 또는 오류를 남겨주세요."}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 p-2 text-xl leading-none"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              {resultMessage?.type === "success" ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-4">✅</div>
                  <p className="text-lg font-medium text-gray-800">{resultMessage.text}</p>
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      resetForm();
                    }}
                    className="mt-6 bg-k-navy text-white px-6 py-3 rounded-xl font-bold w-full"
                  >
                    확인
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCategory("voc")}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-bold border transition-colors",
                        category === "voc" ? "bg-k-navy text-white border-k-navy" : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      문의하기
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategory("feature")}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-bold border transition-colors",
                        category === "feature" ? "bg-k-navy text-white border-k-navy" : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      건의하기
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategory("bug")}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-bold border transition-colors",
                        category === "bug" ? "bg-k-navy text-white border-k-navy" : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      버그 신고하기
                    </button>
                  </div>

                  {category !== "voc" && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-bold text-gray-700">
                        {category === "feature"
                          ? "어떤 기능을 원하나요?"
                          : category === "bug"
                          ? "어떤 문제가 발생했나요?"
                          : ""}
                      </label>
                      <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={
                          category === "feature"
                            ? (appSurface === "child" ? "케이에게 바라는 것을 짧게 적어줘." : "어떤 기능을 원하나요?")
                            : (appSurface === "child" ? "어떤 문제가 생겼어?" : "어떤 문제가 발생했나요?")
                        }
                        className="border border-gray-300 rounded-xl p-3 w-full focus:ring-2 focus:ring-k-navy outline-none"
                        maxLength={100}
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5 flex-1 min-h-[150px]">
                    <label className="text-sm font-bold text-gray-700">
                      {category === "voc" ? "무엇이 궁금한가요?" : "내용"}
                    </label>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={
                        category === "voc"
                          ? (appSurface === "child" ? "케이에게 궁금한 내용을 적어줘." : "문의하실 내용을 입력해 주세요.")
                          : category === "feature"
                          ? (appSurface === "child" ? "왜 필요하고 어떻게 되면 좋을지 알려줘." : "어떻게 바뀌면 좋을지 자세히 알려주세요.")
                          : (appSurface === "child" ? "무엇을 누르거나 말했을 때 문제가 생겼는지 알려줘." : "무엇을 하던 중 문제가 발생했는지 적어주세요.")
                      }
                      className="border border-gray-300 rounded-xl p-3 w-full flex-1 resize-none focus:ring-2 focus:ring-k-navy outline-none"
                      maxLength={2000}
                    />
                  </div>

                  {resultMessage?.type === "error" && (
                    <div className="text-red-500 text-sm font-medium p-2 bg-red-50 rounded-lg">
                      {resultMessage.text}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-k-orange hover:opacity-90 text-white font-bold py-3.5 rounded-xl disabled:opacity-50 transition-colors mt-2"
                  >
                    {isSubmitting ? "제출 중..." : "제출하기"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
