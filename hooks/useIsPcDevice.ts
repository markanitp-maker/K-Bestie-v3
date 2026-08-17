"use client";

import { useEffect, useLayoutEffect, useState } from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * 073 Phase 3: 기기 판정 미디어 쿼리
 * - PC 판정 조건: (pointer: fine) and (hover: hover) and (min-width: 900px)
 *
 * [왜 안전한가]
 * - 스마트폰·태블릿은 주 입력이 거칠어 (pointer: fine)에서 이미 걸러집니다.
 *   또한 (hover: hover) 조건까지 있어 이중으로 걸러집니다.
 * - (any-pointer: coarse)를 추가로 배제할 경우 마우스가 주 입력인 터치스크린 PC·터치 노트북까지
 *   PC 판정에서 잘못 탈락하여 기기 프레임이 사라지는 버그가 발생합니다.
 *
 * [알려진 절충 — Known Trade-off]
 * - 과거 의도: 트랙패드를 붙인 태블릿(iPad + Magic Keyboard 등)이 pointer: fine을 보고하면
 *   PC로 판정될 수 있어, 이를 막기 위해 any-pointer: coarse 배제를 두었음.
 * - 현행 정책: 베타 정책상 확인된 문제만 막습니다(2026-08-17 대표 지시).
 *   지금 확인된 문제는 터치 PC에서 기기 프레임이 사라지는 것이고, 태블릿+트랙패드 오인은 아직 관측되지 않았습니다.
 *   추후 실제 태블릿+트랙패드 오인이 관측되면 그때 좁게 대응을 추가합니다.
 */
export const PC_MEDIA_QUERY = "(pointer: fine) and (hover: hover) and (min-width: 900px)";
/** @deprecated 내부 PC 판정에서 더 이상 사용하지 않음 (하위 호환성을 위해 export 유지) */
export const TOUCH_COARSE_MEDIA_QUERY = "(any-pointer: coarse)";
export const TABLET_MIN_WIDTH_MEDIA_QUERY = "(min-width: 768px)";

export function checkIsPcDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(PC_MEDIA_QUERY).matches;
}

export function useIsPcDevice() {
  // isPc는 초기값이 항상 false(서버 렌더와 맞추기 위함)
  const [isPc, setIsPc] = useState(false);
  const [determined, setDetermined] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const pcMq = window.matchMedia(PC_MEDIA_QUERY);

    const update = () => {
      const pc = pcMq.matches;
      setIsPc(pc);
      setDetermined(true);
    };

    update();
    pcMq.addEventListener("change", update);

    return () => {
      pcMq.removeEventListener("change", update);
    };
  }, []);

  return { isPc, determined };
}
