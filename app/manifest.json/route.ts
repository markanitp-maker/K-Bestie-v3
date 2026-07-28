import { NextResponse } from "next/server";
import { getPwaIcons } from "@/lib/pwaIcons";

export const runtime = "nodejs";

// 정적 public/manifest.json을 이 라우트로 대체한 이유: 환경(Dev/Production)에 따라
// PWA 아이콘(마스코트 vs 말풍선 심볼)을 분기해야 하는데, public/ 정적 파일은 빌드 시점에
// 환경별로 다른 내용을 낼 수 없다. URL은 기존과 동일하게 /manifest.json을 유지한다.
export async function GET() {
  const icons = getPwaIcons();

  return NextResponse.json(
    {
      name: "내친구 케이",
      short_name: "케이",
      description: "아이의 마음을 듣는 AI 친구",
      start_url: "/",
      display: "standalone",
      orientation: "portrait",
      theme_color: "#1A6B5A",
      background_color: "#FFF8E7",
      icons: [
        { src: icons.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: icons.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
        { src: icons.maskableIcon192, sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: icons.maskableIcon512, sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } }
  );
}
