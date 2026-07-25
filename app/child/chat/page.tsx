"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function ChildChatPage() {
  const router = useRouter();
  useEffect(() => {
    if (!localStorage.getItem("k_child_id")) {
      router.replace("/child/home");
      return;
    }
    router.replace("/chat");
  }, [router]);

  return (
    <div
      className="min-h-dvh flex items-center justify-center"
      style={{ background: "var(--color-child-bg)" }}
    >
      <div
        className="w-8 h-8 rounded-full animate-pulse"
        style={{ background: "var(--color-k-orange)" }}
      />
    </div>
  );
}
