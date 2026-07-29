"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 053: 부모 계정 단위 베타 승인 게이트를 완전히 제거하면서 이 화면은 더 이상
// 도달할 경로가 없다. 다만 즐겨찾기/직접 URL 접근 등으로 남아있을 수 있는
// 옛 링크를 위해 삭제 대신 안전한 리다이렉트 스텁으로 남겨둔다.
export default function PendingApprovalPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/parent/home");
  }, [router]);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
      <p className="text-xs text-gray-500 mt-3">페이지 이동 중...</p>
    </div>
  );
}
