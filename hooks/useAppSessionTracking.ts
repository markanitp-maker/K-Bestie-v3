"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type AppSessionAction = "start" | "heartbeat" | "foreground" | "background" | "end";

const HEARTBEAT_INTERVAL_MS = 30_000;

function normalizeRoute(pathname: string | null): string {
  if (!pathname || !pathname.startsWith("/")) return "/";
  return pathname.slice(0, 512);
}

export function useAppSessionTracking(): void {
  const pathname = usePathname();
  const routeRef = useRef(normalizeRoute(pathname));

  useEffect(() => {
    routeRef.current = normalizeRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    const sessionId = crypto.randomUUID();
    let active = false;
    let disposed = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const sendAction = async (action: AppSessionAction, keepalive = false): Promise<boolean> => {
      try {
        const response = await fetch("/api/analytics/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          keepalive,
          body: JSON.stringify({
            session_id: sessionId,
            action,
            route: routeRef.current,
          }),
        });
        // 401(로그아웃)·404(세션 만료)는 재시도해도 회복되지 않는다 — 세션 자체를
        // 종료 처리해 무한 heartbeat 반복을 막는다(codex-rv claude-review 지적).
        if (response.status === 401 || response.status === 404) {
          active = false;
          stopHeartbeat();
        }
        return response.ok;
      } catch {
        return false;
      }
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const startHeartbeat = () => {
      if (!active || disposed || document.visibilityState !== "visible" || heartbeatTimer) return;
      heartbeatTimer = setInterval(() => {
        void sendAction("heartbeat");
      }, HEARTBEAT_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (!active || disposed) return;
      if (document.visibilityState === "visible") {
        void sendAction("foreground");
        startHeartbeat();
      } else {
        stopHeartbeat();
        void sendAction("background", true);
      }
    };

    const handleBeforeUnload = () => {
      if (!active) return;
      stopHeartbeat();
      void sendAction("end", true);
    };

    const start = async () => {
      if (active || disposed) return;
      try {
        const started = await sendAction("start");
        if (!started || disposed) return;
        active = true;
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("beforeunload", handleBeforeUnload);
        startHeartbeat();
      } catch {
        // 분석 계측 실패가 앱 이용을 방해하지 않도록 조용히 종료한다.
      }
    };

    const supabase = createClient();

    // codex-rv claude-review 지적: 루트 레이아웃이 리마운트되지 않는 SPA 전환(로그인
    // 후 router.push+refresh 등)에서는 mount-once 체크만으로 방문이 누락된다.
    // onAuthStateChange로 세션 획득 시점을 직접 감지해 그 시점에 시작한다.
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      if (session?.user && !active) {
        void start();
      } else if (!session?.user && active) {
        active = false;
        stopHeartbeat();
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("beforeunload", handleBeforeUnload);
      }
    });

    // 익명 랜딩 방문자는 analytics API 호출 자체를 하지 않는다. 이 초기 확인은
    // 네트워크 절약용 선행 가드일 뿐이고, actor/멤버십은 API가 다시 검증한다.
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !disposed) void start();
    });

    return () => {
      disposed = true;
      authListener.subscription.unsubscribe();
      stopHeartbeat();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (active) void sendAction("end", true);
    };
  }, []);
}

export function AppSessionTracking() {
  useAppSessionTracking();
  return null;
}
