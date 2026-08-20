"use client";

import React from "react";
import { PlayFrame } from "@/components/play/PlayFrame";

// K-Toon(만화책 읽기) iframe 래퍼. 구조는 app/child/play/mbti/page.tsx 와 같다.
//
// `/play/comic_book` 은 이 앱 자신의 Route Handler
// (app/play/comic_book/[[...path]]/route.ts)가 프록시하므로 iframe 은 동일 Origin 이다.
// 그래서 메시지 origin 검사는 자기 Origin 일치로 충분하고 그 외 출처는 무시한다.
//
// 종료 흐름: K-Toon 은 완독해도 terminal Complete 를 부르지 않는다(통합 계약 §6).
// 아이가 "케이에게 돌아가기" CTA 또는 상단 X 를 누를 때만 Close 로 나간다.
// 자동 복귀는 없다 — 5시간 안에는 같은 책을 다시 읽을 수 있어야 하기 때문이다.
export default function ComicBookWrapperPage() {
  return (
    <PlayFrame
      title="만화책 읽기"
      src="/play/comic_book"
      messageSource="k-play-comic_book"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
    />
  );
}
