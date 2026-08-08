"use client";

import { useNotificationInbox } from "@/lib/notifications/useNotificationInbox";

export function NotificationBadgeSync() {
  useNotificationInbox({ loadItems: false });
  return null;
}

