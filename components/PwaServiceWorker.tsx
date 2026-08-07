"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";

type PwaState =
  | "idle"
  | "checking"
  | "update_available"
  | "deferred_during_session"
  | "activating"
  | "reloading"
  | "up_to_date"
  | "error";

export function PwaServiceWorker() {
  const [pwaState, setPwaState] = useState<PwaState>("idle");
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  const lastDismissedAt = useRef<number>(0);
  const DISMISS_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const isCriticalSession = useCallback(() => {
    const currentPath = pathnameRef.current || "";
    return (
      currentPath.includes("/missions") ||
      currentPath.includes("/chat") ||
      currentPath.includes("/freetalk") ||
      currentPath.includes("/play")
    );
  }, []);

  const printDiagnostics = useCallback(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        const diag = {
          appBuildId: process.env.NEXT_PUBLIC_DEPLOYMENT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "local",
          swActiveVersion: "unknown",
          swBuildId: "unknown",
          swWaitingVersion: "unknown",
          serviceWorkerState: pwaState,
          windowInnerWidth: window.innerWidth,
          visualViewportWidth: window.visualViewport?.width,
          devicePixelRatio: window.devicePixelRatio,
          displayMode: window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser",
        };

        if (reg.active) {
          const channel = new MessageChannel();
          channel.port1.onmessage = (e) => {
            diag.swActiveVersion = e.data.swVersion;
            diag.swBuildId = e.data.buildId;
            console.log("[PWA Diagnostics]", diag);
          };
          reg.active.postMessage({ type: "GET_VERSION" }, [channel.port2]);
        } else {
          console.log("[PWA Diagnostics]", diag);
        }
      });
    }
  }, [pwaState]);

  useEffect(() => {
    if (pwaState === "update_available" || pwaState === "idle" || pwaState === "deferred_during_session") {
      printDiagnostics();
    }
  }, [pwaState, printDiagnostics]);

  const triggerUpdate = useCallback(() => {
    if (waitingWorker) {
      setPwaState("activating");
      waitingWorker.postMessage({ type: "SKIP_WAITING" });

      // If controllerchange doesn't fire within 3 seconds, show error
      setTimeout(() => {
        setPwaState((prev) => (prev === "activating" ? "error" : prev));
      }, 3000);
    }
  }, [waitingWorker]);

  const handleDismiss = () => {
    lastDismissedAt.current = Date.now();
    setPwaState("idle");
  };

  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          const handleUpdateFound = () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  setWaitingWorker(newWorker);
                  setPwaState(isCriticalSession() ? "deferred_during_session" : "update_available");
                }
              });
            }
          };

          registration.addEventListener("updatefound", handleUpdateFound);

          if (registration.waiting && navigator.serviceWorker.controller) {
            setWaitingWorker(registration.waiting);
            setPwaState(isCriticalSession() ? "deferred_during_session" : "update_available");
          }

          const checkUpdate = () => {
            if (navigator.onLine && registration) {
              registration.update().then(() => {
                if (registration.waiting && navigator.serviceWorker.controller) {
                  setWaitingWorker(registration.waiting);
                  setPwaState((prev) => {
                    if (prev === "idle" && Date.now() - lastDismissedAt.current > DISMISS_COOLDOWN_MS) {
                      return isCriticalSession() ? "deferred_during_session" : "update_available";
                    }
                    return prev;
                  });
                }
              }).catch((err) => {
                console.error("SW update check failed", err);
              });
            }
          };

          const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
              checkUpdate();
            }
          };

          window.addEventListener("online", checkUpdate);
          document.addEventListener("visibilitychange", handleVisibilityChange);

          return () => {
            window.removeEventListener("online", checkUpdate);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            registration.removeEventListener("updatefound", handleUpdateFound);
          };
        })
        .catch((err) => {
          console.error("Service Worker registration failed:", err);
        });

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          const currentSha = process.env.NEXT_PUBLIC_DEPLOYMENT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "v1";
          const guardKey = `pwa_sw_reloaded_${currentSha}`;
          if (typeof window !== "undefined" && !sessionStorage.getItem(guardKey)) {
            sessionStorage.setItem(guardKey, "true");
            setPwaState("reloading");
            window.location.reload();
          }
        }
      });
    }
  }, [isCriticalSession]);

  useEffect(() => {
    if (pwaState === "deferred_during_session" && !isCriticalSession()) {
      setPwaState("update_available");
    } else if (pwaState === "update_available" && isCriticalSession()) {
      setPwaState("deferred_during_session");
    }
  }, [pathname, pwaState, isCriticalSession]);

  if (
    pwaState === "idle" ||
    pwaState === "checking" ||
    pwaState === "up_to_date" ||
    pwaState === "activating" ||
    pwaState === "reloading"
  ) {
    return null;
  }

  if (pwaState === "deferred_during_session") {
    return (
      <div
        role="alert"
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-white px-4 py-3 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-100 z-[9999] flex flex-col gap-1 w-[90%] max-w-sm"
      >
        <div className="text-[var(--color-k-navy)] font-bold text-sm">새로운 버전이 준비됐어요.</div>
        <div className="text-gray-600 text-xs">현재 대화를 마친 뒤 업데이트할게요.</div>
      </div>
    );
  }

  if (pwaState === "error") {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-white px-4 py-4 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-100 z-[9999] flex flex-col gap-3 w-[90%] max-w-sm"
      >
        <div>
          <div className="text-[var(--color-k-navy)] font-bold text-base mb-1">새 버전을 적용하지 못했어요.</div>
          <div className="text-gray-600 text-sm break-keep">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</div>
        </div>
        <div className="flex gap-2 justify-end mt-1">
          <button
            onClick={handleDismiss}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-bold rounded-lg active:scale-95 transition-transform"
          >
            나중에
          </button>
          <button
            onClick={triggerUpdate}
            className="px-4 py-2 bg-[var(--color-k-orange)] text-white text-sm font-bold rounded-lg active:scale-95 transition-transform"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  // update_available
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-white px-4 py-4 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-100 z-[9999] flex flex-col gap-3 w-[90%] max-w-sm"
    >
      <div>
        <div className="text-[var(--color-k-navy)] font-bold text-base mb-1">새로운 버전이 준비됐어요.</div>
        <div className="text-gray-600 text-sm break-keep">최신 기능과 화면을 사용하려면 새로고침해 주세요.</div>
      </div>
      <div className="flex gap-2 justify-end mt-1">
        <button
          onClick={handleDismiss}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-bold rounded-lg active:scale-95 transition-transform"
        >
          나중에
        </button>
        <button
          onClick={triggerUpdate}
          className="px-4 py-2 bg-[var(--color-k-orange)] text-white text-sm font-bold rounded-lg active:scale-95 transition-transform flex items-center justify-center min-w-[80px]"
        >
          새로고침
        </button>
      </div>
    </div>
  );
}
