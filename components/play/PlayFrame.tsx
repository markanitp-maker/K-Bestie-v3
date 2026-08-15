"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AppTopHeader } from "@/components/AppTopHeader";
import { DemoFrame } from "@/app/demo/components/DemoFrame";

/** 놀이 종료 후 항상 이 화면으로 복귀한다. */
export const PLAY_RETURN_PATH = "/child/play";

const BLANK_SRC = "about:blank";

/** 놀이 iframe을 정지시킨다.
 *
 * `iframe.src = "about:blank"`로 정지시키면 안 된다 — iframe 탐색은 joint session
 * history에 항목을 하나 더 쌓아서, 닫기를 replace로 바꾼 의미가 사라지고 안드로이드
 * 하드웨어 뒤로가기가 다시 닫은 놀이로 돌아간다(025의 원래 신고 증상).
 *
 * 동일 Origin이므로 `location.replace`로 현재 항목을 덮어써서 항목이 늘지 않게 한다.
 * 접근이 막히면 src 속성을 제거한다 — 이것도 탐색이 아니라 항목을 만들지 않는다. */
export function stopPlayIframe(iframe: HTMLIFrameElement | null) {
  if (!iframe) return;
  try {
    const frameWindow = iframe.contentWindow;
    if (frameWindow) {
      frameWindow.location.replace(BLANK_SRC);
      return;
    }
  } catch {
    // cross-origin 등으로 접근이 막힌 경우 아래 fallback으로 내려간다.
  }
  iframe.removeAttribute("src");
}

/** iframe 안 놀이 앱이 스스로 종료를 요청할 때 쓰는 메시지 계약(SPEC.md §5). */
export function isPlayCloseMessage(event: MessageEvent, origin: string, messageSource: string): boolean {
  if (event.origin !== origin) return false;
  const data = event.data as { type?: unknown; source?: unknown } | null;
  if (!data || typeof data !== "object" || data.source !== messageSource) return false;
  return data.type === "PLAY_AUTO_CLOSE" || data.type === "PLAY_CLOSE_REQUEST";
}

/** 놀이 앱(MBTI/퀴즈마스터)의 공통 실행 컨테이너.
 *
 * 025 원인: 놀이 종료가 `<Link href="/child/play">`(router push)였다. Android에서 놀이를
 * 열고 닫기를 반복하면 history entry가 계속 쌓여, 하드웨어 뒤로가기로 닫은 놀이 화면에
 * 다시 들어가고 이전 iframe이 겹쳐 보였다. 종료는 push가 아니라 replace여야 한다.
 *
 * 닫기 규칙(3-2): 브라우저·라우터 뒤로가기 계열을 쓰지 않는다. iframe을 즉시
 * about:blank로 되돌려 놀이 앱을 정지시킨 뒤 replace로 /child/play 상태만 복원한다. */
export function PlayFrame({
  title,
  src,
  sandbox,
  messageSource,
  hideInnerHeaderCss = true,
}: {
  title: string;
  src: string;
  sandbox: string;
  /** postMessage로 자체 종료를 요청하는 놀이만 지정한다. 없으면 리스너를 걸지 않는다. */
  messageSource?: string;
  hideInnerHeaderCss?: boolean;
}) {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 종료 가드 — 닫기 연타/자동 종료 메시지 중복 수신으로 replace가 여러 번 나가지 않게 한다.
  const closedRef = useRef(false);

  const closePlay = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    // display만 숨기는 재사용 금지(3-2). unmount 전에 먼저 놀이를 정지시킨다.
    stopPlayIframe(iframeRef.current);
    router.replace(PLAY_RETURN_PATH);
  }, [router]);

  useEffect(() => {
    if (!messageSource) return;
    const handlePlayMessage = (event: MessageEvent) => {
      if (!isPlayCloseMessage(event, window.location.origin, messageSource)) return;
      closePlay();
    };
    window.addEventListener("message", handlePlayMessage);
    return () => window.removeEventListener("message", handlePlayMessage);
  }, [messageSource, closePlay]);

  // unmount 시 iframe을 확실히 정지시킨다. Android WebView가 라우트 전환 뒤에도 이전
  // iframe을 잠깐 살려두면서 이벤트를 계속 흘리는 사례를 막는다(3-3).
  useEffect(() => {
    const iframe = iframeRef.current;
    return () => stopPlayIframe(iframe);
  }, []);

  const handleIframeLoad = () => {
    if (!hideInnerHeaderCss) return;
    const iframe = iframeRef.current;
    // 종료 중에 뜨는 blank 문서에는 주입하지 않는다.
    if (!iframe || closedRef.current) return;

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        // 놀이 앱 자체 헤더를 숨겨 공통 헤더와 이중으로 보이지 않게 한다.
        const style = doc.createElement("style");
        style.innerHTML = `
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
        <div className="shrink-0 z-50 pointer-events-auto">
          <AppTopHeader title={title} onBack={closePlay} backVariant="close" />
        </div>

        <div className="flex-1 w-full min-h-0">
          <iframe
            ref={iframeRef}
            src={src}
            className="w-full h-full border-none"
            onLoad={handleIframeLoad}
            sandbox={sandbox}
          />
        </div>
      </div>
    </DemoFrame>
  );
}
