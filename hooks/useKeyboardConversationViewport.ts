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

  return { viewportHeight, isKeyboardOpen };
}
