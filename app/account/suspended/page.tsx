"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// REQUEST-AUTH-SIGNUP-AUTOLOGIN §3.1/§12: 관리자에 의해 이용이 정지(SUSPENDED)된 계정이
// 로그인했을 때 보여주는 안내 화면. 탈퇴(withdrawn)와는 별개 상태 — 여기서는 복구 신청
// 같은 자가 조치를 제공하지 않고 문의하기로만 안내한다(정지 해제는 관리자 판단 영역).
export default function SuspendedAccountPage() {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
      <div className="bg-white p-8 rounded-2xl shadow-sm max-w-md w-full flex flex-col gap-6">
        <div>
          <p className="text-4xl mb-3">🚫</p>
          <h1 className="text-lg font-bold text-gray-800 mb-2">현재 이용이 제한된 계정입니다</h1>
          <p className="text-sm text-gray-600 leading-relaxed">문의하기를 이용해 주세요.</p>
        </div>
        <button onClick={handleLogout} className="text-gray-500 text-sm underline cursor-pointer">
          로그아웃
        </button>
      </div>
    </div>
  );
}
