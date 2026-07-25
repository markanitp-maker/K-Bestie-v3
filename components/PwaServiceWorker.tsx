"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";

export function PwaServiceWorker() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const pathname = usePathname();
  
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // 대화 중인지 확인 (missions, chat 등 대화 관련 경로)
  const isSafeToUpdate = useCallback(() => {
    const currentPath = pathnameRef.current || "";
    // 대화 세션이 활성화된 경로가 아니면 안전
    return !(currentPath.includes("/missions") || currentPath.includes("/chat") || currentPath.includes("/freetalk"));
  }, []);

  const handleUpdate = useCallback(() => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      setShowUpdate(false);
    }
  }, [waitingWorker]);

  // 경로가 변경되어 안전한 상태가 되면 지연된 업데이트 실행
  useEffect(() => {
    if (waitingWorker && isSafeToUpdate()) {
      handleUpdate();
    }
  }, [pathname, waitingWorker, isSafeToUpdate, handleUpdate]);

  useEffect(() => {
    // 버전 식별자 콘솔 출력 (Vercel 배포 시 자동 주입되는 환경 변수 활용)
    const commitSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "local-or-unknown";
    console.log(`[PWA] Current build version (commit): ${commitSha}`);

    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  // A new update is available
                  setWaitingWorker(newWorker);
                  if (isSafeToUpdate()) {
                    newWorker.postMessage({ type: "SKIP_WAITING" });
                  } else {
                    setShowUpdate(true);
                  }
                }
              });
            }
          });

          // Check if there is already a waiting worker
          if (registration.waiting) {
            setWaitingWorker(registration.waiting);
            if (isSafeToUpdate()) {
              registration.waiting.postMessage({ type: "SKIP_WAITING" });
            } else {
              setShowUpdate(true);
            }
          }
          
          // 앱이 백그라운드에서 포그라운드로 복귀할 때 업데이트 확인
          const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
              registration.update();
              // 복귀 시 대화 중이 아니라면 대기 중인 워커 즉시 활성화
              if (registration.waiting && isSafeToUpdate()) {
                registration.waiting.postMessage({ type: "SKIP_WAITING" });
              }
            }
          };
          document.addEventListener("visibilitychange", handleVisibilityChange);

          return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
          };
        })
        .catch((err) => {
          console.error("Service Worker registration failed:", err);
        });

      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && event.data.type === "UPDATE_AVAILABLE") {
          navigator.serviceWorker.getRegistration().then((reg) => {
            if (reg?.waiting) {
              setWaitingWorker(reg.waiting);
              if (isSafeToUpdate()) {
                reg.waiting.postMessage({ type: "SKIP_WAITING" });
              } else {
                setShowUpdate(true);
              }
            }
          });
        }
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }
  }, [isSafeToUpdate]); // isSafeToUpdate is stable due to useCallback

  if (!showUpdate) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white px-4 py-3 rounded-xl shadow-lg border border-gray-200 z-[9999] flex items-center gap-3 w-[90%] max-w-sm">
      <div className="flex-1 text-xs text-gray-700 font-bold">
        새 버전이 준비되었습니다. (현재 대화 중이라 대기 중)
      </div>
      <button
        onClick={handleUpdate}
        className="px-3 py-1.5 bg-[var(--color-k-navy)] text-white text-xs font-bold rounded-lg active:scale-95 transition-transform"
      >
        즉시 업데이트
      </button>
    </div>
  );
}
