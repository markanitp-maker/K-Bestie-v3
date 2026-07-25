"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();

  useEffect(() => {
    // 베타 흐름 제외: 루트(/)로 즉시 리다이렉트
    router.replace("/");
  }, [router]);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
      <p className="text-xs text-gray-500 mt-3">페이지 이동 중...</p>
    </div>
  );
}

