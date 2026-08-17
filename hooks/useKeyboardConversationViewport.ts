import { useState, useEffect, type CSSProperties } from "react";

/**
 * 대화 화면 컨테이너 높이를 정한다.
 *
 * 평소에는 px 를 상시 주입하지 않는다 — 주소창 접힘/펼침마다 화면이 튄다.
 * 대신 `--frame-h` 를 쓰고 없으면 100dvh 로 떨어진다.
 *
 * 2026-08-17: 예전에는 `100dvh` 를 하드코딩했다. 그래서 PC 웹에서 스마트폰/태블릿
 * 프레임으로 볼 때 컨테이너가 프레임 안쪽(--frame-h)보다 커져 **하단이 잘렸다**
 * (자동/수동 토글·마이크가 프레임 밖으로 밀려남). `--frame-h` 는 프레임 안에서만
 * 정의되고 실기기에서는 undefined 라 100dvh 로 떨어진다
 * (DemoFrame.test.tsx "실기기 경로에서는 --frame-h 변수가 정의되지 않아 fallback" 참고).
 *
 * 키보드가 열린 동안에만 실측 px 를 쓴다 — iOS 에서 100dvh 는 키보드만큼 줄지 않아
 * 컨테이너 아래쪽이 키보드 뒤에 남고 그 배경이 공백으로 보인다.
 *
 * 테스트가 이 식을 복제하지 않도록 export 한다. 복제하면 실제 코드와 어긋나도 못 잡는다.
 */
export function computeConversationHeight(
  isKeyboardOpen: boolean,
  viewportHeight: number | null,
): string {
  return isKeyboardOpen && viewportHeight
    ? `${viewportHeight}px`
    : "var(--frame-h, 100dvh)";
}

export function useKeyboardConversationViewport() {
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [viewportOffsetTop, setViewportOffsetTop] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let baseHeight = window.innerHeight;

    const updateViewport = () => {
      const activeEl = document.activeElement;
      const isInputFocused = !!(
        activeEl &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")
      );

      const currentHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      setViewportHeight(currentHeight);
      setViewportOffsetTop(window.visualViewport ? window.visualViewport.offsetTop : 0);

      // baseHeight 보정 (가장 큰 창 높이 기록)
      if (!baseHeight || currentHeight > baseHeight) {
        baseHeight = currentHeight;
      }

      // 키보드가 실제로 화면에 노출되었는지 종합 판정:
      // 1) input/textarea 요소에 포커스가 들어와 있어야 함
      // 2) visualViewport 높이가 기준 높이의 82% 미만으로 유의미하게 축소되었어야 함
      // iOS 키보드 '∨' 버튼으로 키보드만 내리면 currentHeight가 회복되어 isKeyboardOpen이 즉시 false가 됨
      const isOpen = isInputFocused && currentHeight < baseHeight * 0.82;
      setIsKeyboardOpen(isOpen);
    };

    updateViewport();

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateViewport);
      window.visualViewport.addEventListener("scroll", updateViewport);
    }
    window.addEventListener("resize", updateViewport);
    window.addEventListener("focusin", updateViewport);
    window.addEventListener("focusout", updateViewport);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", updateViewport);
        window.visualViewport.removeEventListener("scroll", updateViewport);
      }
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("focusin", updateViewport);
      window.removeEventListener("focusout", updateViewport);
    };
  }, []);

  // 대화 화면 컨테이너 높이.
  //
  // 평소에는 100dvh를 쓴다 — px를 상시 주입하면 주소창 접힘/펼침마다 화면이 튄다.
  // 다만 iOS에서 100dvh는 소프트키보드가 올라와도 줄지 않는다(dvh는 브라우저 UI만
  // 반영하고 키보드는 반영하지 않는다). 그래서 키보드가 열리면 컨테이너 아래쪽이
  // 키보드 뒤에 남고, 그 배경이 입력창과 키보드 사이의 공백으로 보인다.
  // 키보드가 열린 동안에만 실제 visual viewport 높이를 쓴다.
  // 2026-08-17: PC 웹에서 스마트폰/태블릿 프레임으로 볼 때 **하단이 잘렸다**.
  // 100dvh 는 브라우저 창 전체 높이라, DemoFrame 안쪽(--frame-h)보다 커서 컨테이너
  // 아래쪽(자동/수동 토글·마이크)이 프레임 밖으로 밀려나 보이지 않았다.
  // --frame-h 는 프레임 안에서만 정의되고 실기기에서는 undefined 라 100dvh 로 떨어진다
  // (DemoFrame.test.tsx "실기기 경로에서는 --frame-h 변수가 정의되지 않아 fallback" 참고).
  // 같은 파일의 로딩·오류 화면은 이미 이 방식을 쓰고 있었다(app/chat/page.tsx:877).
  const conversationHeight = computeConversationHeight(isKeyboardOpen, viewportHeight);

  // iOS는 키보드가 열리면 높이만 줄이는 게 아니라 페이지 자체를 위로 밀어 올린다
  // (visualViewport.offsetTop > 0). 높이만 맞추면 컨테이너 윗부분이 보이는 영역
  // 위로 빠져나가 상단이 잘리거나 화면 밖으로 사라진다(2026-08-14 실기기 확인).
  // 키보드가 열린 동안에는 컨테이너를 visual viewport에 직접 고정한다.
  const conversationContainerStyle: CSSProperties = isKeyboardOpen && viewportHeight
    ? {
        position: "fixed",
        top: `${viewportOffsetTop}px`,
        left: 0,
        right: 0,
        height: `${viewportHeight}px`,
      }
    // 2026-08-17: 안쪽 그리드만 --frame-h 로 고치고 **이 바깥 래퍼를 놓쳤다.**
    // 래퍼가 100dvh(브라우저 창 전체)로 남아 있어 DemoFrame 안쪽 패딩까지 더해지면
    // 프레임을 넘어섰고, 결과적으로 **프레임에 스크롤바가 생기고 하단이 잘렸다.**
    // 안팎이 같은 기준을 써야 한다.
    : { height: computeConversationHeight(false, null) };

  // 키보드가 홈 인디케이터를 덮고 있는 동안 safe-area 하단 여백은 죽은 공간이다.
  // 그대로 두면 위 공백에 그만큼이 더해진다.
  const bottomSafeAreaInset = isKeyboardOpen ? "0px" : "env(safe-area-inset-bottom)";

  return {
    viewportHeight,
    isKeyboardOpen,
    conversationHeight,
    conversationContainerStyle,
    bottomSafeAreaInset,
  };
}
