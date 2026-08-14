import { NextResponse } from "next/server";
import { PWA_CLIENT_VERSION } from "@/lib/pwa/clientVersion";

export async function GET() {
  const buildId = PWA_CLIENT_VERSION;
  const CACHE_NAME = `kbestie-shell-${buildId}`;

  const swCode = `
const CACHE_NAME = "${CACHE_NAME}";
const BUILD_ID = "${buildId}";

const PRECACHE_ASSETS = [
  "/manifest.json",
  "/offline",
  "/icons/icon-192-v4.png",
  "/icons/icon-512-v4.png",
  "/icons/maskable-icon-192-v4.png",
  "/icons/maskable-icon-512-v4.png",
  "/icons/apple-touch-icon-180-v4.png",
  "/icons/favicon-32.png",
  "/icons/favicon-16.png",
  "/Images/logo/Logo.png",
  "/Images/mascot/mascot-standing.png"
];

self.addEventListener("install", (event) => {
  // 설치가 끝난 새 worker는 waiting 상태를 유지한다. 사용자 확인 뒤 message handler 한 곳에서만
  // skipWaiting을 실행해 기존 active worker와 현재 앱을 먼저 보존한다.
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn("Precache failed:", url, err))
        )
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          // kbestie-shell-로 시작하는 모든 구버전 캐시(kbestie-shell-local 포함) 삭제
          if (name.startsWith("kbestie-shell-") && name !== CACHE_NAME) {
            console.log("[SW] Cleaning up old cache:", name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      // 기존 클라이언트 페이지에 즉시 새 Service Worker 제어권 적용
      return self.clients.claim();
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "GET_VERSION" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ swVersion: CACHE_NAME, buildId: BUILD_ID });
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isHTMLNavigation = event.request.mode === "navigate" || event.request.destination === "document";
  const isRSCRequest = url.searchParams.has("_rsc") || event.request.headers.has("RSC");
  const isNextDataRequest = url.pathname.startsWith("/_next/data/");

  // 1. 네트워크 전용 요청 (캐시 우회)
  if (
    isHTMLNavigation ||
    isRSCRequest ||
    isNextDataRequest ||
    url.pathname.startsWith("/api/") ||
    url.hostname.includes(".supabase.co") ||
    event.request.method !== "GET" ||
    event.request.headers.has("Authorization")
  ) {
    if (isHTMLNavigation) {
      event.respondWith(
        fetch(event.request).catch(() => caches.match("/offline"))
      );
    }
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  // 2. 명시적 화이트리스트 (캐시 우선 전략 허용)
  const isPrecacheAsset = PRECACHE_ASSETS.includes(url.pathname);
  const isNextStatic = url.pathname.startsWith("/_next/static/");

  if (isPrecacheAsset || isNextStatic) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. 화이트리스트에 없는 나머지 GET 요청은 네트워크 전용 처리 (캐싱 안 함)
  return;
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const title = data.title || "새로운 알림이 도착했습니다.";
    const options = {
      body: data.body,
      icon: "/icons/icon-192-v4.png",
      badge: "/icons/icon-192-v4.png",
      data: { url: data.url || "/", notificationId: data.notificationId || data.notification_id || null },
    };
    event.waitUntil((async () => {
      await self.registration.showNotification(title, options);
      try {
        const response = await fetch("/api/notifications?limit=1", { credentials: "include", cache: "no-store" });
        if (response.ok) {
          const inbox = await response.json();
          const unreadCount = Number(inbox.unreadCount || 0);
          if (unreadCount > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(unreadCount);
          if (unreadCount === 0 && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
        }
      } catch (error) {
        console.warn("[SW] badge sync failed", error);
      }
    })());
  } catch (e) {
    console.error("Error parsing push data", e);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  const notificationId = event.notification.data && event.notification.data.notificationId;
  event.waitUntil(
    (async () => {
      if (notificationId) {
        try {
          const response = await fetch("/api/notifications/" + encodeURIComponent(notificationId) + "/read", {
            method: "POST",
            credentials: "include",
          });
          if (response.ok) {
            const result = await response.json();
            const unreadCount = Number(result.unreadCount || 0);
            if (unreadCount > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(unreadCount);
            if (unreadCount === 0 && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
          }
        } catch (error) {
          console.warn("[SW] notification read sync failed", error);
        }
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const targetUrl = new URL(target, self.location.origin).href;
      const sameOrigin = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (sameOrigin) {
        if ("navigate" in sameOrigin) await sameOrigin.navigate(targetUrl);
        return sameOrigin.focus();
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});
`;

  return new NextResponse(swCode, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0, s-maxage=0",
      "Pragma": "no-cache",
      "Expires": "0",
      "Service-Worker-Allowed": "/",
    },
  });
}
