"use client";

import React, { useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppTopHeader } from "@/components/AppTopHeader";
import { DemoFrame } from "@/app/demo/components/DemoFrame";

function QuizmasterWrapperContent() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rawSearchParams = useSearchParams();
  const searchParams = rawSearchParams ?? new URLSearchParams();
  const resumeAttemptId = searchParams.get("resume");

  const iframeSrc = resumeAttemptId 
    ? `/play/quiz?resume=${encodeURIComponent(resumeAttemptId)}` 
    : "/play/quiz";

  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        // 퀴즈마스터 앱 내 헤더 요소를 숨기기 위한 스타일 주입
        const style = doc.createElement("style");
        style.innerHTML = `
          /* 퀴즈마스터 앱 내 헤더 요소 찾아서 숨기기 */
          header, .header, [class*="header"], [class*="Header"], nav { display: none !important; }
        `;
        doc.head.appendChild(style);
      }
    } catch (error) {
      console.warn("Iframe CSS injection failed (possibly CORS):", error);
    }
  };

  return (
    <div className="h-[100dvh] flex flex-col relative bg-white">
      {/* 공통 헤더 */}
      <div className="shrink-0 z-50 pointer-events-auto">
        <AppTopHeader title="퀴즈마스터" backHref="/child/play" />
      </div>
      
      {/* 본문 (Iframe) */}
      <div className="flex-1 w-full min-h-0">
        <iframe 
          ref={iframeRef}
          src={iframeSrc} 
          className="w-full h-full border-none"
          onLoad={handleIframeLoad}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}

export default function QuizmasterWrapperPage() {
  return (
    <DemoFrame>
      <Suspense fallback={<div className="flex-1 bg-white" />}>
        <QuizmasterWrapperContent />
      </Suspense>
    </DemoFrame>
  );
}
