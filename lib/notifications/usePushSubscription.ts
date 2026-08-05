"use client";

import { useCallback, useEffect } from "react";

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const array = Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  return array.buffer as ArrayBuffer;
}

async function subscribeAndSend(): Promise<boolean> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return false;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = subscription.toJSON();
  const res = await fetch("/api/notifications/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return res.ok;
}

/**
 * 부모 홈 화면 등에서 호출한다. 이미 알림 권한이 허용된 경우에만 조용히
 * 구독을 등록/갱신한다(권한 요청 팝업을 임의로 띄우지 않음). 권한 요청은
 * requestAndSubscribe()를 명시적 사용자 액션(버튼 클릭 등)에 연결해 호출한다.
 */
export function usePushSubscription() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;
    subscribeAndSend().catch((err) => console.error("[usePushSubscription] silent resubscribe failed", err));
  }, []);

  const requestAndSubscribe = useCallback(async (): Promise<"granted" | "denied" | "unsupported"> => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return "unsupported";
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const ok = await subscribeAndSend().catch(() => false);
    return ok ? "granted" : "denied";
  }, []);

  return { requestAndSubscribe };
}
