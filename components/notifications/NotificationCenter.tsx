"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useNotificationInbox } from "@/lib/notifications/useNotificationInbox";
import type { NotificationType } from "@/lib/notifications/inbox";

const ICONS: Record<NotificationType, string> = {
  event: "🎉", mission: "🎯", report: "📄", reward: "🔑", system: "🔔",
};

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "방금 전";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}일 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(value));
}

export function NotificationCenter() {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const { notifications, unreadCount, loading, error, markRead, markAllRead } = useNotificationInbox();
  const visible = useMemo(() => filter === "unread" ? notifications.filter((item) => !item.readAt) : notifications, [filter, notifications]);

  const open = async (id: string, targetUrl: string) => {
    setBusyId(id);
    const read = await markRead(id);
    setBusyId(null);
    if (read) router.push(targetUrl);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3">
        <div className="flex gap-2" role="tablist" aria-label="알림 필터">
          <button onClick={() => setFilter("all")} className={`rounded-full px-3 py-1.5 text-xs font-bold ${filter === "all" ? "bg-[#172A46] text-white" : "bg-gray-100 text-gray-600"}`}>전체</button>
          <button onClick={() => setFilter("unread")} className={`rounded-full px-3 py-1.5 text-xs font-bold ${filter === "unread" ? "bg-[#172A46] text-white" : "bg-gray-100 text-gray-600"}`}>안 읽음 {unreadCount}</button>
        </div>
        <button onClick={() => markAllRead()} disabled={unreadCount === 0} className="min-h-11 rounded-xl px-3 text-xs font-bold text-[#C2410C] disabled:text-gray-300">모두 읽음</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? <p className="py-16 text-center text-sm text-gray-500">알림을 불러오는 중이에요…</p>
          : error ? <p className="py-16 text-center text-sm text-red-600">{error}</p>
          : visible.length === 0 ? <div className="rounded-2xl bg-white py-16 text-center"><div className="mb-3 text-4xl">🔔</div><p className="text-sm font-semibold text-gray-500">{filter === "unread" ? "안 읽은 알림이 없어요" : "새로운 알림이 없어요"}</p></div>
          : <div className="flex flex-col gap-3">{visible.map((item) => (
            <button key={item.id} onClick={() => open(item.id, item.targetUrl)} disabled={busyId === item.id} className={`w-full rounded-2xl bg-white p-4 text-left shadow-sm transition ${item.readAt ? "opacity-65" : "ring-1 ring-orange-100"}`}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-50 text-lg" aria-hidden>{ICONS[item.type]}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2"><strong className="text-sm text-gray-900">{item.title}</strong>{!item.readAt && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#E25B12]" />}</span>
                  <span className="mt-1 block text-xs leading-5 text-gray-600">{item.body}</span>
                  <span className="mt-1.5 block text-[11px] text-gray-400">{relativeTime(item.createdAt)}</span>
                </span>
              </div>
            </button>
          ))}</div>}
      </div>
    </div>
  );
}
