"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function WithdrawnAccountPage() {
  const router = useRouter();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    fetch("/api/account/status")
      .then((r) => r.json())
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const handleRestore = async () => {
    if (!confirm("계정을 복구하고 다시 시작하시겠습니까?")) return;
    setRestoring(true);
    try {
      const res = await fetch("/api/account/restore", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        router.replace("/parent/home");
      } else {
        alert(data.error || "복구 처리 중 오류가 발생했습니다.");
      }
    } catch (err) {
      alert("오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">불러오는 중...</p>
      </div>
    );
  }

  if (!status || (status.account_status !== "WITHDRAWN_PENDING" && status.account_status !== "RESTORE_REQUESTED")) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 flex-col gap-4">
        <p className="text-gray-500">잘못된 접근이거나 활성 계정입니다.</p>
        <button onClick={() => router.push("/parent/home")} className="text-blue-500 underline">홈으로 돌아가기</button>
      </div>
    );
  }

  const now = new Date();
  const purgeDate = new Date(status.purge_scheduled_at);
  const isExpired = now >= purgeDate;
  const daysLeft = Math.max(0, Math.ceil((purgeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
      <div className="bg-white p-8 rounded-2xl shadow-sm max-w-md w-full flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">탈퇴 처리된 계정입니다</h1>
          {status.account_status === "WITHDRAWN_PENDING" && (
            <p className="text-sm text-gray-600 leading-relaxed">
              데이터는 탈퇴일로부터 30일 동안 보관되며 이후 삭제됩니다.<br />
              <span className="font-bold text-red-500 mt-2 block">삭제까지 약 {daysLeft}일 남음</span>
            </p>
          )}
          {status.account_status === "RESTORE_REQUESTED" && (
            <p className="text-sm text-gray-600 leading-relaxed">
              복구 신청이 접수되어 관리자 승인을 기다리고 있습니다.
            </p>
          )}
        </div>

        {status.account_status === "WITHDRAWN_PENDING" && !isExpired && (
          <div className="bg-blue-50 p-4 rounded-xl">
            <p className="text-sm text-blue-800 mb-3 font-bold">기존 계정과 정보를 복구하시겠습니까?</p>
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 cursor-pointer"
            >
              {restoring ? "복구 처리 중..." : "계정 복구하기"}
            </button>
          </div>
        )}

        {isExpired && (
          <div className="bg-red-50 p-4 rounded-xl">
            <p className="text-sm text-red-800 font-bold">보관 기간이 만료되어 복구를 신청할 수 없습니다.</p>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="text-gray-500 text-sm underline"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
