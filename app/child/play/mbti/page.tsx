"use client";

import React, { useRef } from "react";
import { AppTopHeader } from "@/components/AppTopHeader";
import { DemoFrame } from "@/app/demo/components/DemoFrame";

export default function MbtiWrapperPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        // MBTI 페이지의 헤더를 가리기 위한 스타일 주입
        const style = doc.createElement("style");
        style.innerHTML = `
          /* MBTI 앱 내 헤더 요소 찾아서 숨기기 */
          header, .header, [class*="header"], [class*="Header"], nav { display: none !important; }
        `;
        doc.head.appendChild(style);
      }
    } catch (error) {
      console.warn("Iframe CSS injection failed (possibly CORS):", error);
    }
  };

  return (
    <DemoFrame>
      <div className="h-[100dvh] flex flex-col relative bg-white">
        {/* 공통 헤더 */}
        <div className="shrink-0 z-50 pointer-events-auto">
          <AppTopHeader title="MBTI" backHref="/child/play" />
        </div>
        
        {/* 본문 (Iframe) */}
        <div className="flex-1 w-full min-h-0">
          <iframe 
            ref={iframeRef}
            src="/play/mbti" 
            className="w-full h-full border-none"
            onLoad={handleIframeLoad}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>
    </DemoFrame>
  );
}
