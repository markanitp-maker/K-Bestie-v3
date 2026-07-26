"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useDemoView } from "@/app/demo/components/DemoViewContext";

export interface KChatbotWidgetProps {
  appSurface: "child" | "parent";
  /** 022: 좌측 하단 플로팅에서 상단 헤더 우측 영역으로 이동 - 이 화면 헤더가 기본
   *  높이보다 더 높거나(예: 진행률 바가 두 줄인 미션 화면) 헤더 우측에 이미 다른
   *  요소(연결상태 표시 등)가 있어 겹치는 경우, 그 아래로 내려 배치하기 위한
   *  세로 오프셋(px). 지정하지 않으면 기본 헤더 높이(약 56px)+safe-area 아래에 온다. */
  topOffsetPx?: number;
  /** 022: 이 위젯은 화면 뷰포트 기준 fixed로 떠 있어, 헤더 콘텐츠 자체가 뷰포트
   *  전체 폭을 쓰지 않고 중앙 정렬된 고정 폭 컬럼인 화면(예: MissionConversationLayout의
   *  maxWidth:560 - 태블릿/PC 폭에서 그 컬럼 바깥에 회색 여백이 생김)에서는 지정한다.
   *  지정하면 뷰포트가 이 값+24px보다 넓을 때 그 중앙 컬럼의 우측 끝에 맞춰 정렬되고,
   *  더 좁을 때(모바일)는 자동으로 기본 뷰포트 우측 정렬로 되돌아간다. */
  containerMaxWidthPx?: number;
}

type Category = "voc" | "feature" | "bug";

export default function KChatbotWidget({ appSurface, topOffsetPx = 56, containerMaxWidthPx }: KChatbotWidgetProps) {
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

  // 022: DemoFrame(app/demo/components/DemoFrame.tsx)은 PC(포인터 fine + 폭 900px
  // 이상)에서 기기 목업을 그리며, 그 목업 안의 실제 페이지 콘텐츠에는
  // innerPaddingTop(태블릿 목업 pt-8=32px, 스마트폰 목업 pt-10=40px, 상단 상태바
  // 높이만큼)을 얹는다. 이 위젯의 버튼은 position:fixed라 그 padding의 영향을
  // 받지 않고 DemoFrame의 이너 디스플레이 영역(y=0) 기준으로 뜨는데, 각 페이지의
  // 실제 헤더는 그 padding 때문에 y=0이 아니라 y=32~40에서 시작한다 - PC 목업에서만
  // topOffsetPx가 실제 헤더보다 32~40px 높게(위로) 계산되어 헤더 아이콘과 겹치는
  // 버그가 있었다(Codex 리뷰 지적, Playwright bounding box로 재현 확인). DemoFrame과
  // 동일한 매체 쿼리로 PC 목업 여부를 판별해 그만큼 보정한다.
  const { view } = useDemoView();
  const [pcMockupPaddingTopPx, setPcMockupPaddingTopPx] = useState(0);
  useEffect(() => {
    const pcMq = window.matchMedia("(pointer: fine) and (min-width: 900px)");
    const update = () => setPcMockupPaddingTopPx(pcMq.matches ? (view === "mobile" ? 40 : 32) : 0);
    update();
    pcMq.addEventListener("change", update);
    return () => pcMq.removeEventListener("change", update);
  }, [view]);

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
      {/* 022: 좌측 하단 플로팅 → 상단 헤더 우측 영역으로 이동, 라벨 "케이 챗봇"→"문의".
          헤더 자체의 DOM 안에 넣지 않고(13개 페이지마다 헤더 구조가 달라 공용 컴포넌트가
          그 내부구조를 알 수 없음) fixed로 화면 우측 상단에 고정 배치해 모든 페이지에서
          동일하게 동작하게 한다. topOffsetPx로 페이지별 헤더 높이/기존 우측 요소(연결상태
          표시 등)와의 겹침을 피한다. */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(true)}
        className={containerMaxWidthPx ? "fixed z-50 flex items-center gap-1.5 px-3 py-2 rounded-full shadow-md text-white transition-colors" : "fixed right-3 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full shadow-md text-white transition-colors"}
        style={{
          background: "var(--color-k-navy)",
          top: `calc(${topOffsetPx + pcMockupPaddingTopPx}px + env(safe-area-inset-top))`,
          // vw는 실제 브라우저 뷰포트 기준으로만 계산돼(이 fixed 버튼의 containing
          // block인 DemoFrame의 transform 요소를 무시함) PC 기기 목업(DemoFrame이 실제
          // 뷰포트보다 좁은 목업 박스를 그리는 경우) 안에서 잘못된 위치로 계산된다.
          // %는 position:fixed에서도 containing block(=DemoFrame의 transform 요소,
          // 없으면 실제 뷰포트)의 폭 기준으로 해석되므로 두 경우 모두 올바르게 맞는다.
          ...(containerMaxWidthPx
            ? { right: `max(0.75rem, calc(50% - ${containerMaxWidthPx / 2}px + 0.75rem))` }
            : {}),
        }}
        aria-label="문의하기 열기"
      >
        <span className="text-base leading-none">💬</span>
        <span className="font-bold text-sm whitespace-nowrap">문의</span>
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
