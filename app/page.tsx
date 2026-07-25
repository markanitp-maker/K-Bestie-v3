"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function HubPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
        return;
      }

      try {
        // 1. 첫 로그인 비밀번호 설정 플래그 및 계정 역할 조회
        const pwCheckRes = await fetch("/api/auth/change-password", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (!pwCheckRes.ok) {
          throw new Error("Password change check failed");
        }

        const pwData = await pwCheckRes.json();

        // 2. 만약 비밀번호를 반드시 변경해야 하는 경우 (구성원 첫 로그인)
        if (pwData.must_change_password) {
          router.replace("/auth/setup-password");
          return;
        }

        // 3. 구성원 계정인 경우 즉시 역할별 대시보드로 이동
        if (pwData.is_member_account) {
          if (pwData.role === "child") {
            // 자녀의 프로필 ID 로딩을 위해 child/me 재조회 후 저장
            const childMeRes = await fetch("/api/child/me");
            if (childMeRes.ok) {
              const childInfo = await childMeRes.json();
              if (childInfo?.id) {
                localStorage.setItem("k_child_id", childInfo.id);
              }
            }
            router.replace("/child/home");
          } else {
            router.replace("/parent/home");
          }
          return;
        }

        // 4. 소셜 로그인(오너) 계정인 경우 기존의 auto-join 호출
        const joinRes = await fetch("/api/auth/auto-join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (joinRes.ok) {
          const joinData = await joinRes.json();
          if (joinData.joined) {
            if (joinData.role === "child") {
              if (joinData.child_profile_id) {
                localStorage.setItem("k_child_id", joinData.child_profile_id);
              }
              router.replace("/child/home");
            } else {
              router.replace("/parent/home");
            }
            return;
          } else {
            if (joinData.reason === "no_email") {
              alert(joinData.message || "이메일 정보가 없어 로그인이 어렵습니다.");
              await supabase.auth.signOut();
              router.replace("/login");
              return;
            }
            // 그 외 예약 데이터 매칭 실패 시 parent/home으로 보내서 가족 그룹을 생성케 함
            router.replace("/parent/home");
            return;
          }
        } else {
          router.replace("/parent/home");
        }
      } catch (err) {
        console.error("Hub page initialization error:", err);
        router.replace("/parent/home");
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
        <p className="text-xs text-gray-500 mt-3">사용자 정보를 확인하는 중...</p>
      </div>
    );
  }

  return null;
}



