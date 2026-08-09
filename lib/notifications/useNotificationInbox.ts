"use client";

import { useCallback, useEffect, useState } from "react";
import type { InboxNotification } from "./inbox";

const CHANGE_EVENT = "kbestie-notifications-changed";

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export async function syncAppBadge(unreadCount: number) {
  if (typeof navigator === "undefined") return;
  const badge = navigator as BadgeNavigator;
  try {
    if (unreadCount > 0 && badge.setAppBadge) await badge.setAppBadge(unreadCount);
    if (unreadCount === 0 && badge.clearAppBadge) await badge.clearAppBadge();
  } catch {
    // Badge API 미지원/OS 거부는 인앱 알림 사용을 막지 않는다.
  }
}

export function useNotificationInbox({ loadItems = true }: { loadItems?: boolean } = {}) {
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/notifications?limit=${loadItems ? 100 : 1}`, { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        setUnreadCount(0);
        await syncAppBadge(0);
      }
      setError(response.status === 401 ? "로그인이 필요해요." : "알림을 불러오지 못했어요.");
      setLoading(false);
      return;
    }
    const data = await response.json();
    if (loadItems) setNotifications(data.notifications ?? []);
    const nextUnread = Number(data.unreadCount ?? 0);
    setUnreadCount(nextUnread);
    setError(null);
    setLoading(false);
    await syncAppBadge(nextUnread);
  }, [loadItems]);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
    const onVisible = () => { if (document.visibilityState === "visible") refresh().catch(() => undefined); };
    const onChanged = () => refresh().catch(() => undefined);
    window.addEventListener("focus", onChanged);
    window.addEventListener(CHANGE_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onChanged);
      window.removeEventListener(CHANGE_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const markRead = useCallback(async (id: string) => {
    const response = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
    if (!response.ok) return false;
    const data = await response.json();
    const now = new Date().toISOString();
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, readAt: item.readAt ?? now } : item));
    const nextUnread = Number(data.unreadCount ?? 0);
    setUnreadCount(nextUnread);
    await syncAppBadge(nextUnread);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  }, []);

  const markAllRead = useCallback(async () => {
    const response = await fetch("/api/notifications/read-all", { method: "POST" });
    if (!response.ok) return false;
    const now = new Date().toISOString();
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
    setUnreadCount(0);
    await syncAppBadge(0);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  }, []);

  return { notifications, unreadCount, loading, error, refresh, markRead, markAllRead };
}

