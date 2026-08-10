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
      try {
        // 익명 랜딩 방문자는 analytics API 호출 자체를 하지 않는다. 이 로컬 세션
        // 확인은 네트워크 절약용 선행 가드일 뿐이고, actor/멤버십은 API가 다시 검증한다.
        const supabase = createClient();
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session?.user || disposed) return;

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

    void start();

    return () => {
      disposed = true;
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
