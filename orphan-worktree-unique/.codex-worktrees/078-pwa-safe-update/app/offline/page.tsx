"use client";

import Image from "next/image";
import { PwaSafeRouteReady } from "@/components/pwa/PwaSafeRouteReady";

export default function OfflinePage() {
  return (
    <>
      <PwaSafeRouteReady expectedPath="/offline" />
      <div
        className="min-h-[100dvh] flex flex-col items-center justify-center p-4 text-center"
        style={{ background: "var(--color-k-background)" }}
      >
      <div className="w-32 h-32 relative mb-6">
        <Image
          src="/Images/mascot/mascot-standing.png"
          alt="케이 마스코트"
          fill
          className="object-contain opacity-50 grayscale"
        />
      </div>
      
      <h1 className="text-2xl font-bold mb-3" style={{ color: "var(--color-k-navy)" }}>
        인터넷 연결이 끊겼어요!
      </h1>
      
      <p className="text-gray-600 mb-8 text-sm leading-relaxed max-w-xs mx-auto">
        케이와 계속 이야기하려면<br />인터넷 연결을 확인해주세요.
      </p>
      
      <button
        onClick={() => window.location.reload()}
        className="px-6 py-3 rounded-xl text-white font-bold text-sm shadow-sm active:scale-95 transition-transform"
        style={{ background: "var(--color-k-navy)" }}
      >
        다시 시도
      </button>
    </div>
    </>
  );
}
