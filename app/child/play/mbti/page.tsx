"use client";

import React from "react";
import { PlayFrame } from "@/components/play/PlayFrame";

// 2026-08-03: MBTI 놀이(iframe 안)가 스스로 종료를 요청할 때 이 래퍼가 대신 종료한다.
//
// 배경: MBTI 앱은 종료가 필요할 때 `window.location`을 쓰고 있었는데, 그건 iframe
// 자기 자신이라 화면이 닫히는 대신 iframe 안에 `/child/play`가 통째로 중첩 렌더됐다
// ("닫아도 하위 화면으로 다시 들어가는 것처럼 보인다" 신고의 원인). MBTI 쪽은
// `lib/playMessage/requestPlatformClose.ts`에서 상위 프레임을 직접 이동시키도록
// 고쳤지만, 위 iframe의 sandbox가 `allow-top-navigation-by-user-activation`이라
// **사용자 조작이 없는** 완료 후 5분 무반응 자동 종료만은 브라우저가 그 이동을 조용히
// 무시한다. 그 경로를 실제로 닫으려면 상위 앱이 메시지를 받아 스스로 종료해야 해서,
// SPEC.md §5가 원래 규정한 `PLAY_AUTO_CLOSE`/`PLAY_CLOSE_REQUEST`를 PlayFrame이 받는다.
//
// `/play/mbti`는 이 앱 자신의 Route Handler(app/play/mbti/[[...path]]/route.ts)가
// 프록시하므로 iframe은 동일 Origin이다 — 그래서 origin 검사는 자기 Origin과의 일치로
// 충분하고, 그 외 출처의 메시지는 전부 무시한다.
export default function MbtiWrapperPage() {
  return (
    <PlayFrame
      title="MBTI"
      src="/play/mbti"
      messageSource="k-play-mbti"
      // 2026-08-03: 퀴즈마스터와 동일한 sandbox 제약(상위 프레임 탐색 불가)이
      // MBTI에도 있으면 같은 부류의 UX 문제가 재현될 수 있어 예방적으로 함께 추가.
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
    />
  );
}
