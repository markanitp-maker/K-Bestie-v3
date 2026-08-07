"use client";

import React, { useState } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { revokeCurrentPushInstallation } from "@/lib/notifications/usePushSubscription";

export interface AppTopHeaderProps {
  title: string;
  onBack?: () => void;
  backHref?: string;
  backLabel?: string;
}

export function AppTopHeader({ title, onBack, backHref = "/child/home", backLabel = "아이 홈으로 돌아가기" }: AppTopHeaderProps) {
  const [isLogoutProcessing, setIsLogoutProcessing] = useState(false);
  const handleLogout = async () => {
    if (isLogoutProcessing) return;
    if (window.confirm("로그아웃할까요?")) {
      setIsLogoutProcessing(true);
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      await revokeCurrentPushInstallation();
      await supabase.auth.signOut();
      localStorage.removeItem("k_child_id");
      localStorage.removeItem("login_role");
      window.location.href = "/login?role=child";
    }
  };

  const BackButton = () => {
    const className = "w-[70px] h-[40px] flex items-center text-sm font-bold cursor-pointer active:scale-95 text-[var(--color-k-navy)]";
    
    if (onBack) {
      return (
        <button onClick={onBack} className={className} aria-label="뒤로가기">
          ← 뒤로
        </button>
      );
    }
    
    return (
      <Link href={backHref} className={className} aria-label={backLabel}>
        ← 뒤로
      </Link>
    );
  };

  return (
    <div className="shrink-0 flex items-center justify-between px-4 z-50 w-full max-w-[430px] mx-auto bg-white/50 backdrop-blur-sm border-b border-black/5" style={{ paddingTop: "max(10px, env(safe-area-inset-top))", paddingBottom: "10px" }}>
      <BackButton />
      <h1 className="flex-1 text-center text-base font-bold truncate px-2" style={{ color: "var(--color-k-navy)" }}>
        {title}
      </h1>
      <div className="w-[70px] flex justify-end">
        <button
          onClick={handleLogout}
          disabled={isLogoutProcessing}
          className="w-[40px] h-[40px] flex items-center justify-center rounded-2xl bg-white/50 shadow-sm transition-transform active:scale-95 cursor-pointer disabled:opacity-50"
          aria-label="로그아웃"
        >
          <LogOut size={18} color="var(--color-k-navy)" />
        </button>
      </div>
    </div>
  );
}
