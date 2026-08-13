"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Pencil,
  Plus,
  Share2,
  Smartphone,
  X,
  type LucideIcon,
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
  icon: LucideIcon;
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
    title: "공유",
    description: "Safari의 공유 버튼을 눌러 주세요.",
    icon: Share2,
  },
  {
    title: "홈 화면에 추가",
    description: "공유 목록에서 ‘홈 화면에 추가’를 선택해 주세요.",
    icon: Smartphone,
  },
  {
    title: "웹 앱으로 열기",
    description: "‘웹 앱으로 열기’가 켜져 있는지 확인해 주세요.",
    icon: Globe,
  },
  {
    title: "추가",
    description: "‘추가’를 눌러 설치를 마쳐 주세요.",
    icon: Plus,
  },
];

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
  const title = isIOSGuide
    ? `${context.device === "ipad" ? "아이패드" : "아이폰"}에 내친구 케이 설치하기`
    : isInAppGuide
      ? IN_APP_TITLES[context.app]
      : "다른 브라우저에서 설치해 보세요";
  const description = isIOSGuide
    ? "Safari에서 아래 순서대로 진행하면 홈 화면에서 앱처럼 이용할 수 있어요."
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
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 px-3 py-3 sm:items-center sm:px-5"
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
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-h-[min(90dvh,48rem)]"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-xl font-black leading-7 text-gray-900">
              {title}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm leading-6 text-gray-600">
              {description}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="설치 안내 닫기"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {isIOSGuide ? (
            <>
              <ol className="space-y-3">
                {IOS_STEPS.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <li key={step.title} className="flex gap-3 rounded-2xl bg-orange-50 p-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-orange-600 shadow-sm">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-gray-900">
                          {index + 1}. {step.title}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-gray-600">{step.description}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-4 rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
                  <Pencil className="h-4 w-4 text-gray-500" aria-hidden="true" />
                  ‘홈 화면에 추가’가 보이지 않나요?
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  공유 목록 아래의 ‘동작 편집’을 열고 ‘홈 화면에 추가’를 추가한 뒤 다시 진행해 주세요.
                </p>
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

          {isInAppGuide && externalBrowserAction && (
            <button
              type="button"
              onClick={() => void handleExternalOpen()}
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 px-4 text-base font-bold text-white transition-colors hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
            >
              <ExternalLink className="h-5 w-5" aria-hidden="true" />
              {externalBrowserAction.label ?? "외부 브라우저에서 열기"}
            </button>
          )}

          {!isIOSGuide && (
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

        <footer className="shrink-0 border-t border-gray-100 bg-white px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 w-full rounded-2xl bg-gray-900 px-4 text-base font-bold text-white transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            닫기
          </button>
        </footer>
      </div>
    </div>
  );
}
