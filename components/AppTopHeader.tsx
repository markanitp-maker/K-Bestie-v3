"use client";

import React, { useState } from "react";
import Link from "next/link";
import { LogOut, X } from "lucide-react";
import { revokeCurrentPushInstallation } from "@/lib/notifications/usePushSubscription";

export interface AppTopHeaderProps {
  title: string;
  onBack?: () => void;
  backHref?: string;
  backLabel?: string;
  /** "close"는 히스토리 이동이 아니라 현재 화면 자체를 종료하는 컨트롤이다(놀이 실행 화면).
   * 025: 놀이는 `← 뒤로` 대신 `X 닫기`를 기본 종료 컨트롤로 쓴다. */
  backVariant?: "back" | "close";
  /** 073: 화면 content width와 일치시키기 위한 최대 너비 (기본값: var(--content-max-width, var(--max-width-smartphone, 430px))) */
  maxWidth?: string;
}

export function AppTopHeader({
  title,
  onBack,
  backHref = "/child/home",
  backLabel = "아이 홈으로 돌아가기",
  backVariant = "back",
  maxWidth = "var(--content-max-width, var(--max-width-smartphone, 430px))",
}: AppTopHeaderProps) {
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
    const isClose = backVariant === "close";
    const content = isClose ? (
      <>
        <X size={18} strokeWidth={2.5} />
        <span className="ml-1">닫기</span>
      </>
    ) : (
      <>← 뒤로</>
    );

    if (onBack) {
      return (
        <button onClick={onBack} className={className} aria-label={isClose ? "닫기" : "뒤로가기"}>
          {content}
        </button>
      );
    }

    return (
      <Link href={backHref} className={className} aria-label={isClose ? "닫기" : backLabel}>
        {content}
      </Link>
    );
  };

  return (
    <div
      className="shrink-0 flex items-center justify-between px-4 z-50 w-full mx-auto bg-white/50 backdrop-blur-sm border-b border-black/5"
      style={{
        maxWidth,
        paddingTop: "max(10px, env(safe-area-inset-top))",
        paddingBottom: "10px",
      }}
    >
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
