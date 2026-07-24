import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // ai.k-bestie.com → 192.168.200.222:3000 포트포워딩 시 HMR WebSocket 허용
  allowedDevOrigins: ["ai.k-bestie.com", "192.168.200.222"],
  env: {
    NEXT_PUBLIC_DEPLOYMENT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  },
};

export default nextConfig;
