import type { NextConfig } from "next";

/**
 * MBTI 놀이: Next.js Multi-Zones rewrite (딥 인터뷰 확정,
 * .omc/specs/deep-interview-mbti-platform-connection.md ②)
 *
 * `/play/mbti` 및 그 하위 모든 경로(정적 자산·API 포함)를 독립 MBTI Vercel 배포로
 * 프록시한다. 실제 upstream 도메인은 `MBTI_UPSTREAM_ORIGIN`(서버 전용 env, NEXT_PUBLIC_
 * 접두사 없음)에만 존재하고 브라우저에는 절대 노출되지 않는다 — rewrite는 서버/엣지
 * 레벨에서 일어나므로 브라우저 주소창·Network 탭에는 항상 플랫폼 도메인만 보인다.
 *
 * `beforeFiles`로 지정하는 이유: K-Bestie-v3 내부에 기존 로컬 구현(`app/play/mbti/**`)이
 * 검증 기간 동안 아직 남아있다. `beforeFiles`가 아니면 Next.js는 파일시스템 라우트를
 * 먼저 매칭시켜 로컬 구현이 rewrite보다 우선하므로, 독립 MBTI로 전환됐는지 확인할 수
 * 없다. `beforeFiles`는 파일시스템 라우트보다 먼저 실행돼 항상 독립 MBTI로 보낸다.
 * 로컬 구현을 삭제한 뒤에도(딥 인터뷰 Round 8-2 확인 대상) 이 설정은 그대로 유지한다.
 */
async function rewrites() {
  const mbtiUpstreamOrigin = process.env.MBTI_UPSTREAM_ORIGIN;
  if (!mbtiUpstreamOrigin) {
    // Dev 초기 세팅 전이나 로컬 개발 중 env 미설정 시 조용히 로컬 구현으로 폴백한다
    // (rewrite 자체를 등록하지 않음) — 배포 환경에서는 반드시 설정돼 있어야 한다.
    console.warn("[next.config] MBTI_UPSTREAM_ORIGIN 미설정 — /play/mbti rewrite 비활성화");
    return {
      beforeFiles: [
        {
          source: "/sw.js",
          destination: "/api/pwa/sw",
        },
      ],
    };
  }

  return {
    beforeFiles: [
      {
        source: "/sw.js",
        destination: "/api/pwa/sw",
      },
      {
        source: "/play/mbti",
        destination: `${mbtiUpstreamOrigin}/play/mbti`,
      },
      {
        source: "/play/mbti/:path*",
        destination: `${mbtiUpstreamOrigin}/play/mbti/:path*`,
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
  },
  rewrites,
};

export default nextConfig;
