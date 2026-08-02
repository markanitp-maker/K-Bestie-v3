import type { NextConfig } from "next";

/**
 * MBTI 놀이: 예전에는 여기서 next.config.ts `rewrites()`(Multi-Zones)로
 * `/play/mbti`를 `MBTI_UPSTREAM_ORIGIN`으로 직접 프록시했다. 2026-08-03
 * Production 장애(빈 화면/연결 실패)로 확인된 근본 원인: MBTI 업스트림 응답이
 * `Content-Security-Policy: frame-ancestors 'none'`을 내려보내는데, 단순
 * rewrite는 업스트림 응답 헤더를 그대로 통과시킬 뿐 제어할 수 없어(quiz-proxy
 * 도입 당시와 동일한 제약, app/api/quiz-proxy/[[...path]]/route.ts 주석 참고)
 * 이 프레임 차단 헤더를 제거·override할 방법이 없었다 — K-Bestie 자신의 iframe
 * 래퍼(app/child/play/mbti/page.tsx)가 자기 자신을 감싸려다 CSP에 의해 매번
 * 조용히 차단됐다(브라우저 콘솔에만 에러가 남고 사용자에게는 빈 화면으로만 보임).
 *
 * 수정: rewrite를 제거하고 app/play/mbti/[[...path]]/route.ts Route Handler로
 * 교체했다 — quiz-proxy와 동일하게 응답 헤더를 allowlist로 재조립해
 * content-security-policy를 비롯한 위험 헤더를 전달하지 않는다. sw.js rewrite만
 * 유지한다.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  // ai.k-bestie.com → 192.168.200.222:3000 포트포워딩 시 HMR WebSocket 허용
  allowedDevOrigins: ["ai.k-bestie.com", "192.168.200.222"],
  env: {
    NEXT_PUBLIC_DEPLOYMENT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/sw.js",
          destination: "/api/pwa/sw",
        },
      ],
    };
  },
};

export default nextConfig;
