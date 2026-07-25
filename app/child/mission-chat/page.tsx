"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MissionChatRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/child/missions");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
    </div>
  );
}
