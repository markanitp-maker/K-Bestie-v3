import { NextResponse } from "next/server";
import { BUILD_STAMP } from "@/lib/pwa/buildStamp";
import { renderServiceWorker } from "@/lib/pwa/renderServiceWorker";

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
  "/Images/mascot/mascot-standing.png",
] as const;

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
