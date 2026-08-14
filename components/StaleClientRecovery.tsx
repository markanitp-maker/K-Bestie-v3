"use client";

import { useEffect, useRef } from "react";
import {
  STALE_ASSET_MESSAGE_TYPE,
  isStaleClientAssetError,
  recoverStaleClient,
} from "@/lib/pwa/staleClientRecovery";

/**
 * 2026-08-14 Production 장애 대응 — 배포 교체로 청크를 못 받은 클라이언트를
 * 사용자 조작 없이 스스로 복구시킨다.
 *
 * 배너로 "업데이트해 주세요"라고 안내해도 아이는 누르지 않는다. 실제 장애에서도
 * "새로운 버전이 준비됐어요" 배너가 떠 있는 채로 47분간 대화가 0턴이었다.
 * 그래서 안내가 아니라 자동 복구가 필요하다.
 */
export function StaleClientRecovery() {
  const recoveringRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const recover = () => {
      if (disposed || recoveringRef.current) return;
      // 한 화면에서 청크 여러 개가 동시에 404가 날 수 있다. 가드를 sessionStorage에
      // 쓰기 전에 겹쳐 들어오면 시도 횟수를 헛되이 소모하므로 여기서도 한 번 막는다.
      recoveringRef.current = true;
      void recoverStaleClient()
        .then((result) => {
          if (result !== "reloading") recoveringRef.current = false;
        })
        .catch(() => {
          // 복구 실패는 현재 화면을 더 망가뜨리지 않는다. 다음 진입에서 다시 시도된다.
          recoveringRef.current = false;
        });
    };

    const handleError = (event: ErrorEvent) => {
      if (isStaleClientAssetError(event.error) || isStaleClientAssetError(event.message)) recover();
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isStaleClientAssetError(event.reason)) recover();
    };

    // 서비스워커가 /_next/static/ 404를 만나면 알려준다 — 예외로 올라오지 않고
    // 화면만 조용히 멈추는 경로(동적 import 대기)를 여기서 잡는다.
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === STALE_ASSET_MESSAGE_TYPE) recover();
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    }

    return () => {
      disposed = true;
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
      }
    };
  }, []);

  return null;
}
