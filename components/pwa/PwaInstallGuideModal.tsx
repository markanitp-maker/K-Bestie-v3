"use client";

import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleHelp,
  Compass,
  Copy,
  Ellipsis,
  ExternalLink,
  Globe,
  Mail,
  MessageCircle,
  Plus,
  Share2,
  X,
} from "lucide-react";

import { logAuthFlowEvent } from "@/lib/analytics/authFlowClient";
import type { PwaBrowserContext } from "@/lib/pwa/standalone";

export interface ExternalBrowserAction {
  /** 호출부에서 실제 기기로 검증한 사용자 클릭 동작만 전달한다. */
  label?: string;
  open: () => boolean | Promise<boolean>;
}

export interface PwaInstallGuideModalProps {
  isOpen: boolean;
  context: PwaBrowserContext;
  onClose: () => void;
  externalBrowserAction?: ExternalBrowserAction;
}

interface InstallStep {
  title: string;
  description: string;
}

type CopyStatus = "idle" | "success" | "failure";

const IN_APP_TITLES = {
  kakao: "카카오톡에서 열려 있어요",
  naver: "네이버 앱에서 열려 있어요",
  instagram: "Instagram에서 열려 있어요",
  facebook: "Facebook에서 열려 있어요",
  other: "앱 안의 브라우저에서 열려 있어요",
} as const;

const IOS_STEPS: InstallStep[] = [
  {
    title: "⋯ 버튼",
    description: "Safari 우측 하단의 ‘⋯’ 버튼을 눌러 주세요.",
  },
  {
    title: "공유",
    description: "‘공유’ 버튼을 눌러 주세요.",
  },
  {
    title: "더 보기",
    description: "아래의 ‘더 보기’ 버튼을 눌러 주세요.",
  },
  {
    title: "홈 화면에 추가",
    description: "‘홈 화면에 추가’ 버튼을 눌러 주세요.",
  },
  {
    title: "추가",
    description: "오른쪽 위의 ‘추가’를 눌러 주세요.",
  },
];

const KAKAO_IOS_STEPS: InstallStep[] = [
  {
    title: "공유 버튼",
    description: "Safari 우측 하단의 공유 버튼을 클릭하세요.",
  },
  {
    title: "Safari로 열기",
    description: "Safari 버튼을 클릭하세요.",
  },
];

const MenuRow = ({ children, emphasized = false }: { children: ReactNode; emphasized?: boolean }) => (
  <div className={`flex h-5 items-center justify-between rounded px-1.5 text-[7px] font-semibold text-gray-700 ${emphasized ? "ring-1 ring-red-500" : ""}`}>
    <span>{children}</span>
    <Share2 className="h-2.5 w-2.5" aria-hidden="true" />
  </div>
);

const IOSStepPreview = ({ step }: { step: number }) => {
  if (step === 0) {
    return (
      <div className="flex h-[52px] w-[132px] items-center justify-between rounded-lg bg-white px-2 shadow-sm ring-1 ring-gray-200 sm:w-[145px]" aria-hidden="true">
        <ArrowLeft className="h-3.5 w-3.5 text-blue-500" />
        <ArrowRight className="h-3.5 w-3.5 text-gray-300" />
        <Share2 className="h-3.5 w-3.5 text-blue-500" />
        <BookOpen className="h-3.5 w-3.5 text-blue-500" />
        <span className="flex h-7 w-8 items-center justify-center rounded-md ring-2 ring-red-500">
          <Ellipsis className="h-4 w-4 text-blue-600" />
        </span>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="w-[132px] rounded-lg bg-white p-1.5 shadow-sm ring-1 ring-gray-200 sm:w-[145px]" aria-hidden="true">
        <div className="flex h-4 items-center justify-between px-1 text-[6px] text-gray-500"><span>복사</span><Copy className="h-2.5 w-2.5" /></div>
        <MenuRow emphasized>공유</MenuRow>
        <MenuRow>읽기 목록에 추가</MenuRow>
        <MenuRow>책갈피 추가</MenuRow>
      </div>
    );
  }

  if (step === 2) {
    const apps = [
      { color: "bg-blue-100", icon: <Globe className="h-3 w-3 text-blue-600" />, label: "AirDrop" },
      { color: "bg-green-500", icon: <MessageCircle className="h-3 w-3 text-white" />, label: "메시지" },
      { color: "bg-blue-500", icon: <Mail className="h-3 w-3 text-white" />, label: "메일" },
      { color: "bg-yellow-300", icon: <MessageCircle className="h-3 w-3 text-gray-800" />, label: "카카오톡" },
    ];
    return (
      <div className="w-[132px] rounded-lg bg-white p-1.5 shadow-sm ring-1 ring-gray-200 sm:w-[145px]" aria-hidden="true">
        <div className="flex justify-around pb-1">
          {apps.map((app) => (
            <div key={app.label} className="flex flex-col items-center gap-0.5 text-[5px] text-gray-600">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full ${app.color}`}>{app.icon}</span>
              <span>{app.label}</span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-0.5 text-[5px] text-gray-600">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 ring-1 ring-red-500"><Ellipsis className="h-3 w-3" /></span>
            <span>더 보기</span>
          </div>
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="w-[132px] rounded-lg bg-white p-1.5 shadow-sm ring-1 ring-gray-200 sm:w-[145px]" aria-hidden="true">
        {["프린트", "읽기 목록에 추가", "책갈피 추가"].map((label) => (
          <div key={label} className="flex h-4 items-center justify-between px-1 text-[6px] text-gray-600"><span>{label}</span><BookOpen className="h-2 w-2" /></div>
        ))}
        <div className="flex h-5 items-center justify-between rounded px-1 text-[6px] font-bold text-gray-800 ring-1 ring-red-500">
          <span>홈 화면에 추가</span><Plus className="h-2.5 w-2.5" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-[132px] rounded-lg bg-white p-1.5 shadow-sm ring-1 ring-gray-200 sm:w-[145px]" aria-hidden="true">
      <div className="flex items-center justify-between pb-1 text-[6px]"><span className="text-blue-500">취소</span><strong>홈 화면에 추가</strong><span className="rounded px-1 font-bold text-blue-600 ring-1 ring-red-500">추가</span></div>
      <div className="flex items-center gap-2 rounded bg-gray-50 p-1.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-lg">🐕</div>
        <div className="min-w-0 text-[6px] text-gray-500"><strong className="block text-[7px] text-gray-800">내친구 케이</strong><span>내친구 케이</span><span className="block truncate">https://naechingu-k.com</span></div>
      </div>
    </div>
  );
};

const KakaoIOSStepPreview = ({ step }: { step: number }) => {
  if (step === 0) {
    return (
      <div className="w-[148px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm sm:w-[174px]" aria-hidden="true">
        <div className="h-2.5 bg-gray-500" />
        <div className="flex h-[54px] items-center justify-between px-3 text-gray-400">
          <ArrowLeft className="h-4 w-4" />
          <ArrowRight className="h-4 w-4" />
          <span className="flex h-9 w-9 items-center justify-center ring-2 ring-red-500">
            <Share2 className="h-5 w-5 text-gray-900" />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-[148px] items-start justify-around rounded-xl border border-gray-200 bg-white px-1.5 py-2 shadow-sm sm:w-[174px]" aria-hidden="true">
      <div className="flex flex-col items-center gap-1 ring-2 ring-red-500 ring-offset-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-white">
          <Compass className="h-5 w-5" />
        </span>
        <span className="text-[6px] font-bold text-gray-800">Safari로 열기</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100"><Copy className="h-4 w-4" /></span>
        <span className="text-[6px] text-gray-700">URL 복사하기</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100"><Ellipsis className="h-4 w-4" /></span>
        <span className="text-[6px] text-gray-700">더 보기</span>
      </div>
    </div>
  );
};

const isGuideContext = (
  context: PwaBrowserContext,
): context is Extract<
  PwaBrowserContext,
  { kind: "ios-safari" | "in-app-browser" | "regular-browser-unsupported" }
> =>
  context.kind === "ios-safari" ||
  context.kind === "in-app-browser" ||
  context.kind === "regular-browser-unsupported";

const copyCurrentAddress = async (): Promise<void> => {
  const address = window.location.href;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(address);
      return;
    } catch {
      // Clipboard 권한이 없으면 아래의 동기식 브라우저 fallback을 시도한다.
    }
  }

  const previouslyFocused = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = address;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  let succeeded = false;
  try {
    textarea.select();
    succeeded = document.execCommand("copy");
  } finally {
    textarea.remove();
    if (previouslyFocused instanceof HTMLElement) {
      previouslyFocused.focus();
    }
  }

  if (!succeeded) {
    throw new Error("주소 복사 실패");
  }
};

export function PwaInstallGuideModal({
  isOpen,
  context,
  onClose,
  externalBrowserAction,
}: PwaInstallGuideModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const hasLoggedInAppViewRef = useRef(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [externalOpenFailed, setExternalOpenFailed] = useState(false);
  const shouldRender = isOpen && isGuideContext(context);

  useEffect(() => {
    if (!shouldRender) return;

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusableElements || focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [onClose, shouldRender]);

  useEffect(() => {
    if (!shouldRender) {
      setCopyStatus("idle");
      setExternalOpenFailed(false);
    }
  }, [shouldRender]);

  useEffect(() => {
    const isOpenInAppGuide = shouldRender && context.kind === "in-app-browser";
    if (!isOpenInAppGuide) {
      hasLoggedInAppViewRef.current = false;
      return;
    }

    if (hasLoggedInAppViewRef.current) return;
    hasLoggedInAppViewRef.current = true;
    void logAuthFlowEvent("external_browser_cta_view");
  }, [context.kind, shouldRender]);

  if (!shouldRender) return null;

  const isIOSGuide = context.kind === "ios-safari";
  const isInAppGuide = context.kind === "in-app-browser";
  const isKakaoIOSGuide = isInAppGuide && context.app === "kakao" && context.os === "ios";
  const isReferenceGuide = isIOSGuide || isKakaoIOSGuide;
  const title = isIOSGuide
    ? `${context.device === "ipad" ? "아이패드" : "아이폰"}에 내친구 케이 설치하기`
    : isKakaoIOSGuide
      ? "카카오톡에서 열려 있어요"
    : isInAppGuide
      ? IN_APP_TITLES[context.app]
      : "다른 브라우저에서 설치해 보세요";
  const description = isIOSGuide
    ? "Safari에서 아래 순서대로 진행하면 홈 화면에서 앱처럼 이용할 수 있어요."
    : isKakaoIOSGuide
      ? "아래 단계를 따라 Safari에서 다시 열어 앱 설치를 계속 진행해 주세요."
    : isInAppGuide
      ? "현재 주소를 복사한 뒤 Safari 또는 Chrome 같은 일반 브라우저에서 다시 열어 주세요."
      : "현재 브라우저에서는 설치 요청 화면이 제공되지 않았어요. 브라우저의 공유 또는 메뉴에서 홈 화면 추가 기능을 확인해 주세요.";

  const handleCopy = async () => {
    if (isInAppGuide) {
      void logAuthFlowEvent("external_browser_cta_click");
    }

    try {
      await copyCurrentAddress();
      setCopyStatus("success");
      setExternalOpenFailed(false);
    } catch {
      setCopyStatus("failure");
    }
  };

  const handleExternalOpen = async () => {
    if (!externalBrowserAction) return;
    void logAuthFlowEvent("external_browser_cta_click");

    try {
      const opened = await externalBrowserAction.open();
      setExternalOpenFailed(!opened);
    } catch {
      setExternalOpenFailed(true);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[100] flex justify-center bg-black/45 px-3 py-3 sm:px-5 ${isReferenceGuide ? "items-center" : "items-end sm:items-center"}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[min(94dvh,52rem)] ${isReferenceGuide ? "max-w-[390px] rounded-2xl" : "max-w-md rounded-3xl"}`}
      >
        <header className={`relative flex shrink-0 items-start gap-3 px-5 ${isReferenceGuide ? `pb-3 pt-5 ${isIOSGuide ? "text-center" : "text-left"}` : "border-b border-gray-100 py-4"}`}>
          <div className={`min-w-0 flex-1 ${isKakaoIOSGuide ? "pr-10" : isIOSGuide ? "px-8" : ""}`}>
            <h2 id={titleId} className={`font-black leading-7 ${isReferenceGuide ? `${isKakaoIOSGuide ? "text-[24px]" : "text-[20px]"} text-[#092d63]` : "text-xl text-gray-900"}`}>
              {title}
            </h2>
            <p id={descriptionId} className={`mt-1 text-gray-600 ${isReferenceGuide ? `${isIOSGuide ? "px-5" : "pr-7"} text-[12px] leading-[18px]` : "text-sm leading-6"}`}>
              {description}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="설치 안내 닫기"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${isReferenceGuide ? "absolute right-2 top-1" : ""}`}
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </header>

        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${isReferenceGuide ? "px-5 pb-2 pt-1" : "px-5 py-5"}`}>
          {isKakaoIOSGuide ? (
            <>
              <ol className="space-y-2.5">
                {KAKAO_IOS_STEPS.map((step, index) => (
                  <li key={step.title} className="grid min-h-[140px] grid-cols-[minmax(0,1fr)_148px] items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-3 py-3 sm:grid-cols-[minmax(0,1fr)_174px]">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#071b3e] text-sm font-black text-white">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[15px] font-black leading-6 text-[#071b3e]">{step.title}</p>
                        <p className="mt-2 text-[11px] leading-[18px] text-gray-600">{step.description}</p>
                      </div>
                    </div>
                    <KakaoIOSStepPreview step={index} />
                  </li>
                ))}
              </ol>

              <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#d9e1ee] bg-[#f5f7fb] px-3 py-3">
                <CircleHelp className="h-6 w-6 shrink-0 text-[#50627e]" aria-hidden="true" />
                <p className="text-[11px] font-semibold leading-[17px] text-[#50627e]">
                  Safari로 열리면 앱 설치를 계속 진행해 주세요.
                </p>
              </div>
            </>
          ) : isIOSGuide ? (
            <>
              <ol className="space-y-1.5">
                {IOS_STEPS.map((step, index) => {
                  return (
                    <li key={step.title} className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_132px] items-center gap-2 rounded-xl border border-[#eee8df] bg-[#fbf8f3] px-2.5 py-1.5 sm:grid-cols-[minmax(0,1fr)_145px]">
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#092d63] text-[11px] font-black text-white">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[14px] font-black leading-5 text-[#092d63]">{step.title}</p>
                          <p className="mt-1 text-[10px] leading-[14px] text-gray-600">{step.description}</p>
                        </div>
                      </div>
                      <IOSStepPreview step={index} />
                    </li>
                  );
                })}
              </ol>

              <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-[#cbd8eb] bg-[#f1f6ff] px-3 py-2.5">
                <CircleHelp className="h-7 w-7 shrink-0 text-[#092d63]" aria-hidden="true" />
                <div>
                  <p className="text-[12px] font-black text-[#092d63]">‘홈 화면에 추가’가 보이지 않나요?</p>
                  <p className="mt-0.5 text-[9px] leading-[13px] text-gray-600">공유 목록 아래의 ‘동작 편집’에서 추가해 주세요.</p>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="flex items-start gap-3">
                <Globe className="mt-0.5 h-6 w-6 shrink-0 text-orange-600" aria-hidden="true" />
                <div>
                  <p className="font-extrabold text-gray-900">일반 브라우저에서 다시 열기</p>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    주소를 복사해 Safari 또는 Chrome의 주소창에 붙여넣으면 설치를 계속할 수 있어요.
                  </p>
                </div>
              </div>
            </div>
          )}

          {isInAppGuide && !isKakaoIOSGuide && externalBrowserAction && (
            <button
              type="button"
              onClick={() => void handleExternalOpen()}
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 px-4 text-base font-bold text-white transition-colors hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
            >
              <ExternalLink className="h-5 w-5" aria-hidden="true" />
              {externalBrowserAction.label ?? "외부 브라우저에서 열기"}
            </button>
          )}

          {!isReferenceGuide && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 text-base font-bold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
            >
              {copyStatus === "success" ? (
                <Check className="h-5 w-5 text-green-600" aria-hidden="true" />
              ) : (
                <Copy className="h-5 w-5" aria-hidden="true" />
              )}
              주소 복사하기
            </button>
          )}

          <div className="mt-3 min-h-6 text-center text-sm font-semibold" aria-live="polite" aria-atomic="true">
            {copyStatus === "success" && (
              <p className="text-green-700">
                주소를 복사했어요. Safari 또는 Chrome 주소창에 붙여넣어 주세요.
              </p>
            )}
            {copyStatus === "failure" && (
              <p className="text-gray-600">주소를 복사하지 못했어요. 주소 표시줄에서 직접 복사해 주세요.</p>
            )}
            {externalOpenFailed && (
              <p className="text-gray-600">브라우저를 열지 못했어요. 아래에서 주소를 복사해 주세요.</p>
            )}
          </div>
        </div>

        <footer className={`shrink-0 bg-white px-5 ${isReferenceGuide ? "pb-4 pt-2" : "border-t border-gray-100 py-4"}`}>
          <button
            type="button"
            onClick={onClose}
            className={`min-h-12 w-full rounded-xl px-4 text-base font-bold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${isReferenceGuide ? "bg-[#092d63] hover:bg-[#06244f] focus-visible:ring-[#092d63]" : "bg-gray-900 hover:bg-gray-800 focus-visible:ring-gray-900"}`}
          >
            닫기
          </button>
        </footer>
      </div>
    </div>
  );
}
