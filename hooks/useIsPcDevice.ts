"use client";

import { useEffect, useLayoutEffect, useState } from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * 073 Phase 3: 기기 판정 미디어 쿼리
 * - PC 판정 조건: (pointer: fine) and (hover: hover) and (min-width: 900px) AND NOT (any-pointer: coarse)
 * - 터치 스크린이 있는 태블릿(마우스/트랙패드 연결 여부와 무관하게 any-pointer: coarse가 참)을 PC로 오인하지 않도록 방지.
 */
export const PC_MEDIA_QUERY = "(pointer: fine) and (hover: hover) and (min-width: 900px)";
export const TOUCH_COARSE_MEDIA_QUERY = "(any-pointer: coarse)";
export const TABLET_MIN_WIDTH_MEDIA_QUERY = "(min-width: 768px)";

export function checkIsPcDevice(): boolean {
  if (typeof window === "undefined") return false;
  const isFineHoverWide = window.matchMedia(PC_MEDIA_QUERY).matches;
  const hasCoarseTouch = window.matchMedia(TOUCH_COARSE_MEDIA_QUERY).matches;
  return isFineHoverWide && !hasCoarseTouch;
}

export function useIsPcDevice() {
  // isPc는 초기값이 항상 false(서버 렌더와 맞추기 위함)
  const [isPc, setIsPc] = useState(false);
  const [determined, setDetermined] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const pcMq = window.matchMedia(PC_MEDIA_QUERY);
    const touchMq = window.matchMedia(TOUCH_COARSE_MEDIA_QUERY);

    const update = () => {
      const pc = pcMq.matches && !touchMq.matches;
      setIsPc(pc);
      setDetermined(true);
    };

    update();
    pcMq.addEventListener("change", update);
    touchMq.addEventListener("change", update);

    return () => {
      pcMq.removeEventListener("change", update);
      touchMq.removeEventListener("change", update);
    };
  }, []);

  return { isPc, determined };
}
