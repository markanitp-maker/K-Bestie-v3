"use client";

import { useEffect, useRef, useState } from "react";

const EMBED_HEIGHT_MESSAGE_TYPE = "k-bestie-retention-embed-height";
const MIN_HEIGHT = 400;

// requests/064 — 관리자 사이드바 "사용자 리텐션" 탭을 별도 페이지 이동 없이
// /admin 공통 프레임(사이드바+상단바) 안에서 그대로 보여주기 위한 same-origin
// iframe 래퍼. src는 동일 도메인의 /admin/retention?embed=1(관리자 전용 라우트,
// requireAdmin()이 API 레벨에서 여전히 그대로 검증)만 사용한다 — 외부 origin은
// 절대 허용하지 않는다.
export function RetentionEmbed() {
  const [height, setHeight] = useState(MIN_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // same-origin만 신뢰 — 다른 origin에서 보낸 메시지는 무시한다.
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== EMBED_HEIGHT_MESSAGE_TYPE) return;
      if (typeof e.data.height !== "number") return;
      setHeight(Math.max(MIN_HEIGHT, Math.ceil(e.data.height)));
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      src="/admin/retention?embed=1"
      title="사용자 리텐션"
      style={{
        width: "100%",
        height,
        border: 0,
        display: "block",
        overflow: "hidden", // 높이를 콘텐츠에 맞춰 갱신하므로 iframe 자체 스크롤은 없음 — 바깥 /admin 페이지만 스크롤된다.
      }}
      scrolling="no"
    />
  );
}
