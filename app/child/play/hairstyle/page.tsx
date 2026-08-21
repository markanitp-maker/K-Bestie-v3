"use client";

import React from "react";
import { PlayFrame } from "@/components/play/PlayFrame";

// HairStyle(헤어스타일) iframe 래퍼. 구조는 app/child/play/mbti/page.tsx 와 같다.
//
// `/play/hairstyle` 은 이 앱 자신의 Route Handler
// (app/play/hairstyle/[[...path]]/route.ts)가 프록시하므로 iframe 은 동일 Origin 이다.
// 그래서 메시지 origin 검사는 자기 Origin 일치로 충분하고 그 외 출처는 무시한다.
//
// 종료 흐름: 상단 X 는 PlayFrame 이 직접 닫고, iframe 안에서 스스로 끝내려면
// postMessage 로 알린다(계약은 PlayFrame 의 isPlayCloseMessage).
// HairStyle 이 complete 를 부르는지 close 로 끝내는지는 **아직 확인하지 않았다** —
// 확인되면 이 주석을 갱신한다. 어느 쪽이든 이 래퍼는 바뀌지 않는다.
export default function HairstyleWrapperPage() {
  return (
    <PlayFrame
      title="헤어스타일"
      src="/play/hairstyle"
      messageSource={["k-play-hairstyle", "k-play-hair-style"]}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
    />
  );
}
