import type { NextConfig } from "next";

/**
 * MBTI 놀이: `/play/mbti`는 next.config.ts의 rewrite(Multi-Zones)가 아니라
 * app/play/mbti/[[...path]]/route.ts(Route Handler)가 단일 경로로 프록시한다
 * (2026-08 Production 장애 근본원인 수정 — 그 파일 상단 주석 참고).
 *
 * 이전에는 여기서 `beforeFiles`로 `/play/mbti`, `/play/mbti/:path*`를
 * `MBTI_UPSTREAM_ORIGIN`으로 직접 rewrite했다. Vercel의 외부 도메인 rewrite는
 * 업스트림 응답 헤더(Content-Security-Policy: frame-ancestors 'none' 포함)를
 * 그대로 통과시키는데, K-Bestie 자신의 iframe 래퍼(app/child/play/mbti/page.tsx)가
 * 자기 자신을 그 헤더로 감싸려다 매번 조용히 차단되어 "MBTI 진입 시 빈 화면"의
 * 원인이 됐다. Route Handler는 quiz-proxy(app/api/quiz-proxy/[[...path]]/route.ts)와
 * 동일하게 응답 헤더를 allowlist로 재조립해 위험 헤더를 절대 통과시키지 않는다.
 * `/play/mbti`는 파일시스템 라우트이므로 rewrite 없이도 정상 매칭된다 — 이 함수에
 * 다시 추가하지 않는다.
 */
async function rewrites() {
  return {
    beforeFiles: [
      {
        source: "/sw.js",
        destination: "/api/pwa/sw",
      },
    ],
  };
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  // ai.k-bestie.com → 192.168.200.222:3000 포트포워딩 시 HMR WebSocket 허용
  allowedDevOrigins: ["ai.k-bestie.com", "192.168.200.222"],
  env: {
    NEXT_PUBLIC_DEPLOYMENT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "local",
    // 공개 boolean feature flag만 client bundle에 명시적으로 주입한다. 둘 다 미설정이면
    // useSttRouter가 Browser primary를 끄고 기존 GCP-only 경로를 유지한다.
    BROWSER_STT_PRIMARY_ENABLED: process.env.BROWSER_STT_PRIMARY_ENABLED || "",
    GCP_STT_FALLBACK_ENABLED: process.env.GCP_STT_FALLBACK_ENABLED || "",
  },
  rewrites,
};

export default nextConfig;
