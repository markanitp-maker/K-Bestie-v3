"use client";

import React, { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AppTopHeader } from "@/components/AppTopHeader";
import { DemoFrame } from "@/app/demo/components/DemoFrame";

export default function MbtiWrapperPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const router = useRouter();

  // 2026-08-03: MBTI 놀이(iframe 안)가 스스로 종료를 요청할 때 이 래퍼가 대신 라우팅한다.
  //
  // 배경: MBTI 앱은 종료가 필요할 때 `window.location`을 쓰고 있었는데, 그건 iframe
  // 자기 자신이라 모달이 닫히는 대신 iframe 안에 `/child/play`가 통째로 중첩 렌더됐다
  // ("닫아도 하위 화면으로 다시 들어가는 것처럼 보인다" 신고의 원인). MBTI 쪽은
  // `lib/playMessage/requestPlatformClose.ts`에서 상위 프레임을 직접 이동시키도록
  // 고쳤지만, 위 iframe의 sandbox가 `allow-top-navigation-by-user-activation`이라
  // **사용자 조작이 없는** 완료 후 5분 무반응 자동 종료만은 브라우저가 그 이동을 조용히
  // 무시한다. 그 경로를 실제로 닫으려면 상위 앱이 메시지를 받아 스스로 라우팅해야 해서,
  // SPEC.md §5가 원래 규정한 `PLAY_AUTO_CLOSE`/`PLAY_CLOSE_REQUEST`를 여기서 받는다.
  //
  // `/play/mbti`는 이 앱 자신의 Route Handler(app/play/mbti/[[...path]]/route.ts)가
  // 프록시하므로 iframe은 동일 Origin이다 — 그래서 origin 검사는 자기 Origin과의 일치로
  // 충분하고, 그 외 출처의 메시지는 전부 무시한다.
  useEffect(() => {
    const handlePlayMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const data = event.data as { type?: unknown; source?: unknown } | null;
      if (!data || typeof data !== "object" || data.source !== "k-play-mbti") return;
      if (data.type !== "PLAY_AUTO_CLOSE" && data.type !== "PLAY_CLOSE_REQUEST") return;

      router.push("/child/play");
    };

    window.addEventListener("message", handlePlayMessage);
    return () => window.removeEventListener("message", handlePlayMessage);
  }, [router]);

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
            // 2026-08-03: 퀴즈마스터와 동일한 sandbox 제약(상위 프레임 탐색 불가)이
            // MBTI에도 있으면 같은 부류의 UX 문제가 재현될 수 있어 예방적으로 함께 추가.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
          />
        </div>
      </div>
    </DemoFrame>
  );
}
