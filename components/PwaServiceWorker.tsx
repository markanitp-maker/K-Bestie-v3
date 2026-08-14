"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  PWA_ACTIVATION_DELAY_MS,
  decideUpdateWorkerAction,
  isPwaDismissCooldownActive,
  pwaUpdateCopy,
} from "@/lib/pwa/updateFlow";
import { PWA_CLIENT_VERSION } from "@/lib/pwa/clientVersion";

type PwaState =
  | "idle"
  | "checking"
  | "update_available"
  | "deferred_during_session"
  | "activating"
  | "delayed"
  | "offline"
  | "reloading"
  | "up_to_date"
  | "error";

const BUILD_ID =
  process.env.NEXT_PUBLIC_DEPLOYMENT_SHA ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  PWA_CLIENT_VERSION;
const RELOAD_GUARD_KEY = `pwa_sw_reloaded_${BUILD_ID}`;
const DISMISS_KEY = `pwa_sw_dismissed_${BUILD_ID}`;

function debugLog(event: string) {
  if (process.env.NODE_ENV !== "production") console.info(`[PWA] ${event}`);
}

export function PwaServiceWorker() {
  const [pwaState, setPwaState] = useState<PwaState>("idle");
  const pathname = usePathname() ?? "";
  const pathnameRef = useRef(pathname);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const activationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerChangeHandledRef = useRef(false);
  const lastDismissedAtRef = useRef(0);

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

  const clearActivationTimer = useCallback(() => {
    if (activationTimerRef.current) {
      clearTimeout(activationTimerRef.current);
      activationTimerRef.current = null;
    }
  }, []);

  const scheduleDelayedState = useCallback(() => {
    clearActivationTimer();
    activationTimerRef.current = setTimeout(() => {
      activationTimerRef.current = null;
      setPwaState((current) => {
        if (current !== "activating") return current;
        debugLog("activation_delayed");
        return "delayed";
      });
    }, PWA_ACTIVATION_DELAY_MS);
  }, [clearActivationTimer]);

  const rememberWaitingWorker = useCallback((worker: ServiceWorker, allowPrompt = true) => {
    waitingWorkerRef.current = worker;
    if (!allowPrompt || isPwaDismissCooldownActive(lastDismissedAtRef.current)) return;
    debugLog("update_available");
    setPwaState(isCriticalSession() ? "deferred_during_session" : "update_available");
  }, [isCriticalSession]);

  const startWaitingWorker = useCallback((worker: ServiceWorker) => {
    controllerChangeHandledRef.current = false;
    clearActivationTimer();
    setPwaState("activating");
    debugLog("activation_started");
    worker.postMessage({ type: "SKIP_WAITING" });
    scheduleDelayedState();
  }, [clearActivationTimer, scheduleDelayedState]);

  const refreshRegistration = useCallback(async (registration: ServiceWorkerRegistration) => {
    setPwaState("checking");
    try {
      await registration.update();
    } catch {
      debugLog("update_check_failed");
      setPwaState(navigator.onLine ? "error" : "offline");
      return;
    }

    if (registration.waiting?.state === "installed") {
      rememberWaitingWorker(registration.waiting, false);
      startWaitingWorker(registration.waiting);
      return;
    }
    if (registration.installing || waitingWorkerRef.current?.state === "activating") {
      setPwaState("activating");
      scheduleDelayedState();
      return;
    }

    // waiting worker가 사라졌다면 다른 탭에서 이미 활성화됐을 수 있다. 동일 stale 객체에
    // 메시지를 반복하지 않고 현재 페이지를 한 번만 안전하게 새로고침한다.
    setPwaState("reloading");
    window.location.reload();
  }, [rememberWaitingWorker, scheduleDelayedState, startWaitingWorker]);

  const triggerUpdate = useCallback(async () => {
    clearActivationTimer();
    if (!navigator.onLine) {
      setPwaState("offline");
      return;
    }

    const registration = registrationRef.current ?? await navigator.serviceWorker.getRegistration();
    if (!registration) {
      setPwaState("error");
      return;
    }
    registrationRef.current = registration;

    const remembered = waitingWorkerRef.current;
    const action = decideUpdateWorkerAction({
      waitingState: registration.waiting?.state,
      installingState: registration.installing?.state,
      rememberedState: remembered?.state,
    });

    if (action === "message_waiting") {
      const worker = registration.waiting?.state === "installed" ? registration.waiting : remembered;
      if (worker?.state === "installed") startWaitingWorker(worker);
      else await refreshRegistration(registration);
      return;
    }
    if (action === "wait_for_transition") {
      setPwaState("activating");
      scheduleDelayedState();
      return;
    }
    await refreshRegistration(registration);
  }, [clearActivationTimer, refreshRegistration, scheduleDelayedState, startWaitingWorker]);

  const handleDismiss = useCallback(() => {
    clearActivationTimer();
    const dismissedAt = Date.now();
    lastDismissedAtRef.current = dismissedAt;
    try {
      sessionStorage.setItem(DISMISS_KEY, String(dismissedAt));
    } catch {}
    setPwaState("idle");
  }, [clearActivationTimer]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    const workerCleanups: Array<() => void> = [];

    try {
      lastDismissedAtRef.current = Number(sessionStorage.getItem(DISMISS_KEY) || 0);
    } catch {}

    const observeWorker = (worker: ServiceWorker) => {
      const handleStateChange = () => {
        if (disposed) return;
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          rememberWaitingWorker(worker);
        } else if (worker.state === "activating") {
          setPwaState((current) => current === "checking" ? "activating" : current);
        } else if (worker.state === "redundant" && waitingWorkerRef.current === worker) {
          waitingWorkerRef.current = null;
        }
      };
      worker.addEventListener("statechange", handleStateChange);
      workerCleanups.push(() => worker.removeEventListener("statechange", handleStateChange));
      handleStateChange();
    };

    const handleUpdateFound = () => {
      if (registration?.installing) observeWorker(registration.installing);
    };

    const backgroundCheck = async () => {
      if (!navigator.onLine || !registration || disposed) return;
      try {
        await registration.update();
        if (registration.waiting && navigator.serviceWorker.controller) {
          rememberWaitingWorker(registration.waiting);
        }
      } catch {
        // 백그라운드 확인 실패는 현재 앱 사용을 막거나 팝업을 반복 노출하지 않는다.
        debugLog("update_check_failed");
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void backgroundCheck();
    };

    const handleControllerChange = () => {
      if (controllerChangeHandledRef.current) return;
      controllerChangeHandledRef.current = true;
      clearActivationTimer();
      waitingWorkerRef.current = null;
      setPwaState("up_to_date");
      debugLog("controller_changed");

      // reload 여부와 activation 성공 판정을 분리한다. guard가 이미 있어도 성공 상태는 유지하고
      // 과거 timer가 error/delayed로 덮어쓰지 못한다.
      try {
        if (sessionStorage.getItem(RELOAD_GUARD_KEY)) {
          setPwaState("idle");
          return;
        }
        sessionStorage.setItem(RELOAD_GUARD_KEY, "true");
      } catch {}
      setPwaState("reloading");
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    window.addEventListener("online", backgroundCheck);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    navigator.serviceWorker.register("/sw.js").then((nextRegistration) => {
      if (disposed) return;
      registration = nextRegistration;
      registrationRef.current = nextRegistration;
      registration.addEventListener("updatefound", handleUpdateFound);
      if (registration.installing) observeWorker(registration.installing);
      if (registration.waiting && navigator.serviceWorker.controller) {
        rememberWaitingWorker(registration.waiting);
      }
    }).catch(() => {
      // 최초 등록 실패도 앱 사용 실패가 아니다. 사용자가 현재 버전을 계속 쓰도록 조용히 유지한다.
      debugLog("registration_failed");
    });

    return () => {
      disposed = true;
      clearActivationTimer();
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("online", backgroundCheck);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      registration?.removeEventListener("updatefound", handleUpdateFound);
      workerCleanups.forEach((cleanup) => cleanup());
    };
  }, [clearActivationTimer, rememberWaitingWorker]);

  useEffect(() => {
    if (pwaState === "deferred_during_session" && !isCriticalSession()) {
      if (!isPwaDismissCooldownActive(lastDismissedAtRef.current)) setPwaState("update_available");
    } else if (pwaState === "update_available" && isCriticalSession()) {
      setPwaState("deferred_during_session");
    }
  }, [pathname, pwaState, isCriticalSession]);

  if (["idle", "checking", "up_to_date", "activating", "reloading"].includes(pwaState)) return null;

  if (pwaState === "deferred_during_session") {
    return (
      <div role="alert" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-white px-4 py-3 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-100 z-[9999] flex flex-col gap-1 w-[90%] max-w-sm">
        <div className="text-[var(--color-k-navy)] font-bold text-sm">새로운 버전이 준비됐어요.</div>
        <div className="text-gray-600 text-xs">현재 대화를 마친 뒤 업데이트할게요.</div>
      </div>
    );
  }

  if (pwaState === "delayed" || pwaState === "offline" || pwaState === "error") {
    const copy = pwaUpdateCopy(pwaState);
    return (
      <div role="alertdialog" aria-modal="true" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-white px-4 py-4 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-100 z-[9999] flex flex-col gap-3 w-[90%] max-w-sm">
        <div>
          <div className="text-[var(--color-k-navy)] font-bold text-base mb-1">{copy.title}</div>
          <div className="text-gray-600 text-sm break-keep">{copy.body}</div>
        </div>
        <div className="flex gap-2 justify-end mt-1">
          <button onClick={handleDismiss} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-bold rounded-lg active:scale-95 transition-transform">나중에</button>
          <button onClick={triggerUpdate} className="px-4 py-2 bg-[var(--color-k-orange)] text-white text-sm font-bold rounded-lg active:scale-95 transition-transform">{copy.action}</button>
        </div>
      </div>
    );
  }

  return (
    <div role="alertdialog" aria-modal="true" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-white px-4 py-4 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-100 z-[9999] flex flex-col gap-3 w-[90%] max-w-sm">
      <div>
        <div className="text-[var(--color-k-navy)] font-bold text-base mb-1">새로운 버전이 준비됐어요.</div>
        <div className="text-gray-600 text-sm break-keep">최신 기능과 화면을 사용하려면 새로고침해 주세요.</div>
      </div>
      <div className="flex gap-2 justify-end mt-1">
        <button onClick={handleDismiss} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-bold rounded-lg active:scale-95 transition-transform">나중에</button>
        <button onClick={triggerUpdate} className="px-4 py-2 bg-[var(--color-k-orange)] text-white text-sm font-bold rounded-lg active:scale-95 transition-transform flex items-center justify-center min-w-[80px]">지금 업데이트</button>
      </div>
    </div>
  );
}
