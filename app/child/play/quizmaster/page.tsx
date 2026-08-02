"use client";

import React, { useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppTopHeader } from "@/components/AppTopHeader";
import { DemoFrame } from "@/app/demo/components/DemoFrame";

function QuizmasterWrapperContent() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const searchParams = useSearchParams();
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
          // 2026-08-03: 퀴즈마스터 완료 후 "닫기" 클릭 시 메인 놀이 화면으로 나가지 못하고
          // 퀴즈마스터 내부 화면으로 되돌아가는 신고 조사 중 발견 — 이 sandbox에
          // allow-top-navigation류 권한이 전혀 없어, 퀴즈 앱이 완료 후 "닫기"에서
          // 상위 프레임(window.top) 이동을 시도해도 브라우저가 조용히 차단하고 퀴즈 앱은
          // 자신의 내부 라우팅(이전 화면)으로만 폴백했을 것으로 추정된다(같은 조사에서
          // MBTI 쪽은 CSP frame-ancestors로 확인된 것과 동일한 클래스의 sandbox 제약
          // 문제). 실사용자 조작(클릭)에 한해서만 상위 탐색을 허용해 무단 리다이렉트
          // 위험 없이 이 경로를 열어준다.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
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
