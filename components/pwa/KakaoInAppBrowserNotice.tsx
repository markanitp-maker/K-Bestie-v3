"use client";

import { useEffect, useState } from "react";
import { isIOSDevice, isKakaoInAppBrowser } from "@/lib/pwa/standalone";

async function copyCurrentAddress(address: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(address);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = address;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function KakaoInAppBrowserNotice() {
  const [browser, setBrowser] = useState<"checking" | "not-kakao" | "ios" | "other">(
    "checking"
  );
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    const userAgent = navigator.userAgent;
    if (!isKakaoInAppBrowser(userAgent)) {
      setBrowser("not-kakao");
      return;
    }
    setBrowser(isIOSDevice(userAgent) ? "ios" : "other");
  }, []);

  if (browser === "checking" || browser === "not-kakao") return null;

  const handleOpenExternal = () => {
    const target = window.location.href;
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(target)}`;
  };

  const handleCopy = async () => {
    try {
      await copyCurrentAddress(window.location.href);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <aside
      className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-left"
      aria-label="카카오톡 브라우저 안내"
    >
      <p className="text-sm font-bold" style={{ color: "var(--color-k-navy)" }}>
        카카오톡 브라우저에서는 앱 설치가 제한될 수 있어요
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
        {browser === "ios"
          ? "오른쪽 아래 ···를 누른 뒤 ‘Safari로 열기’를 선택해 주세요."
          : "메뉴의 ···를 누른 뒤 ‘다른 브라우저로 열기’를 선택해 주세요."}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleOpenExternal}
          className="min-h-11 rounded-xl px-3 text-xs font-bold text-white"
          style={{ background: "var(--color-k-navy)" }}
        >
          외부 브라우저로 열기
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700"
        >
          {copied ? "주소 복사 완료" : "주소 복사"}
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-gray-500" aria-live="polite">
        {copyFailed
          ? "주소를 복사하지 못했어요. 카카오톡 메뉴에서 외부 브라우저로 열어 주세요."
          : "외부 브라우저 버튼이 동작하지 않으면 주소를 복사해 Safari나 Chrome에 붙여 넣어 주세요."}
      </p>
    </aside>
  );
}
