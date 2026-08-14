import { NextResponse } from "next/server";
import { BUILD_STAMP } from "@/lib/pwa/buildStamp";
import {
  DEFAULT_PWA_CACHE_ASSETS,
  renderServiceWorker,
} from "@/lib/pwa/renderServiceWorker";

export const PRECACHE_ASSETS = DEFAULT_PWA_CACHE_ASSETS;

export async function GET() {
  const buildId = BUILD_STAMP;
  const swVersion = `kbestie-shell-${buildId}`;

  const swCode = renderServiceWorker({
    buildId,
    buildStamp: BUILD_STAMP,
    swVersion,
    cacheAssets: PRECACHE_ASSETS,
  });

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
