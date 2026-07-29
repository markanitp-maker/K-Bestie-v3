"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 053: 부모 계정 단위 베타 신청 흐름을 제거했다. 삭제 대신 안전한 리다이렉트
// 스텁으로 남겨 옛 링크/북마크가 깨진 화면으로 이어지지 않게 한다.
export default function BetaApplyPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/onboarding");
  }, [router]);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
      <p className="text-xs text-gray-500 mt-3">페이지 이동 중...</p>
    </div>
  );
}
