import { NextResponse } from "next/server";
import { BUILD_STAMP } from "@/lib/pwa/buildStamp";

export async function GET() {
  // 배포 식별자를 쓴다. 손으로 올리는 상수를 쓰면 상수를 안 올린 배포에서 이 파일이
  // 바이트까지 동일해져 브라우저가 서비스워커를 갱신하지 않고, 옛 청크 캐시가 그대로
  // 남는다 — 아이가 앱을 껐다 켜도 안 고쳐지던 원인이다(2026-08-14 장애).
  const buildId = BUILD_STAMP;
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

// 배포 교체로 청크가 사라진 상황(404)만 해당 탭에 알린다.
//
// 전체 브로드캐스트를 하지 않는 이유: 새 빌드로 이미 정상 로드된 다른 탭까지 캐시를
// 지우고 새로고침시키기 때문이다. 404를 실제로 받은 클라이언트에만 보낸다.
function notifyStaleAsset(clientId) {
  if (!clientId) return;
  self.clients.get(clientId).then((client) => {
    if (client) client.postMessage({ type: "K_STALE_ASSET" });
  }).catch(() => {});
}

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
          // 2026-08-14 Production 장애: 아이가 앱을 쓰는 중 프로덕션 배포가 나가면
          // 이미 로드된 페이지가 사라진 청크를 요청해 404를 받는다. 이때 예외가
          // 위로 올라오지 않고 동적 import가 그냥 멈춰(자유대화 "준비하고 있어요...",
          // 미션 "접속이 끊겼네?") 아이는 아무것도 할 수 없다. 여기서 열린 탭에
          // 알려 캐시를 비우고 자동 새로고침하게 한다.
          if (isNextStatic && networkResponse && networkResponse.status === 404) {
            notifyStaleAsset(event.clientId);
          }
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        });
        // fetch 거부(네트워크 끊김)는 여기서 알리지 않는다. 거부의 대다수는 배포
        // 교체가 아니라 연결 불안정인데, 그때 캐시를 지우고 새로고침하면 아이 화면만
        // 더 깨진다. 배포 교체 신호는 위의 404 분기 하나로 충분하다.
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
