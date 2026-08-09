"use client";

import { useCallback, useEffect, useState } from "react";

export type PushPermission = NotificationPermission | "unsupported";
export type PushServerStatus = {
  role: "parent" | "child";
  onboardingCompleted: boolean;
  isExistingUser: boolean;
  active: boolean;
  parentReportEnabled: boolean;
  missionStartEnabled: boolean;
};

function urlBase64ToUint8Array(value: string): BufferSource {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0))).buffer as ArrayBuffer;
}

function getInstallationId() {
  const key = "kbestie_push_installation_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export async function revokeCurrentPushInstallation() {
  if (typeof window === "undefined") return;
  const installationId = localStorage.getItem("kbestie_push_installation_id");
  if (!installationId) return;
  await fetch("/api/notifications/subscribe", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, keepalive: true,
    body: JSON.stringify({ installationId }),
  }).catch(() => undefined);
}

function clientMetadata() {
  const ua = navigator.userAgent;
  return {
    platform: /iPad|iPhone|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "desktop",
    browser: /Edg\//.test(ua) ? "edge" : /CriOS|Chrome\//.test(ua) ? "chrome" : /Safari\//.test(ua) ? "safari" : "other",
  };
}

async function registerSubscription(installationId: string): Promise<boolean> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return false;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  const json = subscription.toJSON();
  const response = await fetch("/api/notifications/subscribe", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, installationId, deviceId: installationId, ...clientMetadata() }),
  });
  return response.ok;
}

export function usePushSubscription() {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [status, setStatus] = useState<PushServerStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      await revokeCurrentPushInstallation();
      setLoading(false); return;
    }
    const current = Notification.permission;
    setPermission(current);
    const installationId = getInstallationId();
    const response = await fetch(`/api/notifications/subscribe?installationId=${encodeURIComponent(installationId)}`, { cache: "no-store" });
    let nextStatus: PushServerStatus | null = null;
    if (response.ok) {
      nextStatus = await response.json();
      setStatus(nextStatus);
    }
    const preferenceEnabled = !nextStatus || (nextStatus.role === "parent" ? nextStatus.parentReportEnabled : nextStatus.missionStartEnabled);
    if (current === "granted" && preferenceEnabled) await registerSubscription(installationId).catch(() => false);
    if (current !== "granted") await revokeCurrentPushInstallation();
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
    const onFocus = () => refresh().catch(() => undefined);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [refresh]);

  // This function must be called directly from a user click. Permission is requested before any await.
  const requestAndSubscribe = useCallback(async (): Promise<"granted" | "denied" | "unsupported" | "error"> => {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    if (Notification.permission === "denied") { setPermission("denied"); return "denied"; }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") return "denied";
    const ok = await registerSubscription(getInstallationId()).catch(() => false);
    if (ok) await refresh();
    return ok ? "granted" : "error";
  }, [refresh]);

  const defer = useCallback(async () => {
    await fetch("/api/notifications/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "defer" }) });
    setStatus((current) => current ? { ...current, onboardingCompleted: true } : current);
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (enabled) return requestAndSubscribe();
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    await fetch("/api/notifications/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preference", enabled: false }) });
    if (subscription) {
      await fetch("/api/notifications/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint, installationId: getInstallationId() }) });
      await subscription.unsubscribe();
    }
    setStatus((current) => current ? { ...current, active: false, parentReportEnabled: false, missionStartEnabled: false } : current);
    return "denied" as const;
  }, [requestAndSubscribe]);

  return { permission, status, loading, requestAndSubscribe, defer, setEnabled, refresh };
}
