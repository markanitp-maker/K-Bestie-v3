import { NextResponse } from "next/server";

export async function GET() {
  const buildId = process.env.NEXT_PUBLIC_DEPLOYMENT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "local";
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
          if (name.startsWith("kbestie-shell-") && name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
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
`;

  return new NextResponse(swCode, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
