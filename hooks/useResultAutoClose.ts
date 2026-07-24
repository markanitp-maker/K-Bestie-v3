"use client";

/**
 * US-010 — 결과 화면(S5) 완료 후 5분 무반응 자동 종료 (SPEC.md §4, §2.1 step 9)
 *
 * 판정 로직 자체(절대 시각 비교)는 `lib/mbti/autoClose.ts`의 순수 함수
 * `isAutoCloseDue`에 있다. 이 훅은 그 판정을 "언제 다시 계산할지"만 담당한다.
 *
 * SPEC.md §4는 `setTimeout` 단독 방식을 명시적으로 금지한다 — 기기가 절전/백그라운드
 * 상태였다가 돌아왔을 때 예약된 `setTimeout`은 정확한 시각에 실행되지 않거나 아예
 * 실행되지 않을 수 있기 때문이다(§9 "6분+ 잠금 후 복귀 즉시 닫힘" 케이스). 그래서
 * 실제 정확성의 근거는 아래 이벤트 기반 재계산이고, `setInterval`은 탭이 열린 채로
 * 유지되는 동안의 최선 노력(best-effort) 보조 수단일 뿐이다.
 *
 * - `active`가 true가 되는 시점(S5 진입, 재실행 포함)을 `last_activity_at`의 시작점으로
 *   삼는다.
 * - `pointerdown`/`keydown`/`click`을 "사용자 활동"으로 보고 `last_activity_at`을
 *   갱신한다(타이머 틱으로 갱신하지 않는다 — 그러면 자동 종료가 절대 발동하지 않게 된다).
 * - `visibilitychange`/`pageshow`/`focus`/`online`/마운트 시점마다 절대 시각을 다시
 *   비교해 만료 여부를 재계산한다(SPEC.md §4 필수 트리거 목록).
 * - 만료로 판정되면 `onAutoClose`를 호출한다. 이 훅은 스스로 이중 호출을 막지 않는다 —
 *   호출부(현재 `MbtiPlayScreen`의 `requestClose`)가 idempotent 종료 함수여야 한다
 *   (수동 닫기와 동일한 함수 공유, PRD US-010 인수조건).
 *
 * US-015(SPEC.md §8 "잠금·백그라운드 후 복귀" 로그·분석 이벤트): 이 훅이 이미 갖고 있는
 * `visibilitychange`(visible로 전환될 때)/`pageshow`/`focus`/`online` 리스너 — 즉 "잠금·
 * 백그라운드 후 복귀"를 감지하는 데 필요한 신호는 이미 여기 다 있다 — 를 그대로 재사용해
 * 선택적 `onResumeFromBackground` 콜백을 호출한다. 새로운 감지 로직을 따로 만들지 않는다.
 * 만료 판정(`checkExpiry`)과는 무관하게, "복귀 이벤트가 발생했다" 자체를 알리는 용도라
 * 인자 없이 호출한다 — 페이로드 구성(child_id 등)은 호출부(`MbtiPlayScreen`) 책임이다.
 */

import { useEffect, useRef } from "react";

import { isAutoCloseDue } from "@/lib/mbti/autoClose";

/** 탭이 열려 포커스된 상태로 유지되는 동안의 보조 체크 주기(최선 노력, 유일한 판정 수단 아님). */
const PROACTIVE_CHECK_INTERVAL_MS = 15_000;

/** SPEC.md §4 "재계산" 대상 중 사용자 조작으로 볼 수 있는 이벤트. */
const ACTIVITY_EVENT_NAMES = ["pointerdown", "keydown", "click"] as const;

export function useResultAutoClose(
  active: boolean,
  onAutoClose: () => void,
  onResumeFromBackground?: () => void,
): void {
  const lastActivityAtRef = useRef<number>(Date.now());
  const onAutoCloseRef = useRef(onAutoClose);
  onAutoCloseRef.current = onAutoClose;
  const onResumeFromBackgroundRef = useRef(onResumeFromBackground);
  onResumeFromBackgroundRef.current = onResumeFromBackground;

  useEffect(() => {
    if (!active || typeof window === "undefined") {
      return;
    }

    // S5 진입(또는 재실행으로 다시 마운트) 시점 = "완료 후" 5분 카운트의 시작점.
    lastActivityAtRef.current = Date.now();

    const checkExpiry = (): void => {
      if (isAutoCloseDue(lastActivityAtRef.current, Date.now())) {
        onAutoCloseRef.current();
      }
    };

    const recordActivity = (): void => {
      lastActivityAtRef.current = Date.now();
    };

    // "잠금·백그라운드 후 복귀"로 볼 수 있는 이벤트에서만 분석 로그 콜백을 호출한다.
    // visibilitychange는 hidden→visible 전환일 때만(탭을 숨길 때는 "복귀"가 아니다).
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        onResumeFromBackgroundRef.current?.();
      }
      checkExpiry();
    };
    const handleReturnEvent = (): void => {
      onResumeFromBackgroundRef.current?.();
      checkExpiry();
    };

    // 마운트 시(재실행 포함) 1회 즉시 재계산 — 예: 오래 잠들었다 돌아온 케이스. 이 최초
    // 호출은 "복귀 이벤트"가 아니라 마운트 자체이므로 onResumeFromBackground를 부르지 않는다.
    checkExpiry();

    for (const eventName of ACTIVITY_EVENT_NAMES) {
      window.addEventListener(eventName, recordActivity);
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handleReturnEvent);
    window.addEventListener("focus", handleReturnEvent);
    window.addEventListener("online", handleReturnEvent);

    const intervalId = window.setInterval(checkExpiry, PROACTIVE_CHECK_INTERVAL_MS);

    return () => {
      for (const eventName of ACTIVITY_EVENT_NAMES) {
        window.removeEventListener(eventName, recordActivity);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handleReturnEvent);
      window.removeEventListener("focus", handleReturnEvent);
      window.removeEventListener("online", handleReturnEvent);
      window.clearInterval(intervalId);
    };
  }, [active]);
}
