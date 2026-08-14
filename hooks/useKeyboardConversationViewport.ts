import { useState, useEffect } from "react";

export function useKeyboardConversationViewport() {
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

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
  const conversationHeight = isKeyboardOpen && viewportHeight
    ? `${viewportHeight}px`
    : "100dvh";

  // 키보드가 홈 인디케이터를 덮고 있는 동안 safe-area 하단 여백은 죽은 공간이다.
  // 그대로 두면 위 공백에 그만큼이 더해진다.
  const bottomSafeAreaInset = isKeyboardOpen ? "0px" : "env(safe-area-inset-bottom)";

  return { viewportHeight, isKeyboardOpen, conversationHeight, bottomSafeAreaInset };
}
