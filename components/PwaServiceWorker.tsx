"use client";

import { useEffect, useState } from "react";

export function PwaServiceWorker() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
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
                  setShowUpdate(true);
                }
              });
            }
          });

          // Check if there is already a waiting worker
          if (registration.waiting) {
            setWaitingWorker(registration.waiting);
            setShowUpdate(true);
          }
        })
        .catch((err) => {
          console.error("Service Worker registration failed:", err);
        });

      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && event.data.type === "UPDATE_AVAILABLE") {
          navigator.serviceWorker.getRegistration().then((reg) => {
            if (reg?.waiting) {
              setWaitingWorker(reg.waiting);
              setShowUpdate(true);
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
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      setShowUpdate(false);
    }
  };

  if (!showUpdate) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white px-4 py-3 rounded-xl shadow-lg border border-gray-200 z-[9999] flex items-center gap-3 w-[90%] max-w-sm">
      <div className="flex-1 text-xs text-gray-700 font-bold">
        새 버전이 있어요. 지금 업데이트할까요?
      </div>
      <button
        onClick={handleUpdate}
        className="px-3 py-1.5 bg-[#1a6b5a] text-white text-xs font-bold rounded-lg active:scale-95 transition-transform"
      >
        업데이트
      </button>
    </div>
  );
}
