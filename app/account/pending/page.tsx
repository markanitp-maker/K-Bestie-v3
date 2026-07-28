"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function PendingApprovalPage() {
  const router = useRouter();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/account/approval-status")
      .then((r) => r.json())
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (status?.approval_status === "approved") {
      router.replace("/parent/home");
    } else if (status?.approval_status === "pending" && !status?.has_applied) {
      router.replace("/beta/apply");
    }
  }, [status, router]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">불러오는 중...</p>
      </div>
    );
  }

  if (status?.approval_status === "approved" || (status?.approval_status === "pending" && !status?.has_applied)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">이동 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
      <div className="bg-white p-8 rounded-2xl shadow-sm max-w-md w-full flex flex-col gap-6">
        <div>
          {status?.approval_status === "rejected" ? (
            <>
              <h1 className="text-xl font-bold text-gray-800 mb-2">베타 신청이 승인되지 않았습니다</h1>
              <p className="text-sm text-gray-600 leading-relaxed">
                {status?.rejected_reason
                  ? status.rejected_reason
                  : "안내드린 사유로 이번 베타에서는 함께하기 어려운 점 양해 부탁드립니다."}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-gray-800 mb-2">현재 베타 승인 대기 중입니다</h1>
              <p className="text-sm text-gray-600 leading-relaxed">
                승인 완료 후 서비스를 이용할 수 있습니다.<br />
                조금만 기다려주시면 곧 확인 후 연락드릴게요.
              </p>
            </>
          )}
        </div>

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
