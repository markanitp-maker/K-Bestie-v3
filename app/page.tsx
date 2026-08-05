"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export default function HubPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // PWA의 manifest start_url이 "/"라서 앱을 재실행·백그라운드 복귀·재부팅할 때마다
    // 이 페이지가 항상 가장 먼저 실행된다. 기존 코드는 getSession()(로컬 저장소만
    // 읽는 조회, 서버 검증·리프레시 강제 없음)이 null을 반환하면 곧바로 로그인
    // 화면으로 보냈는데, 실제로는 (1) 저장된 access token이 만료됐지만 refresh
    // token은 아직 유효해서 서버 검증 시 정상 복구 가능한 경우, (2) 오프라인
    // 복귀 직후처럼 일시적 네트워크 오류로 세션 조회 자체가 실패한 경우에도
    // 똑같이 로그인 화면으로 튕겨나갔다. getUser()는 로컬 세션이 없거나 만료
    // 상태여도 서버에 검증·리프레시를 강제하므로, 진짜 로그아웃 여부를 판정하기
    // 전에 반드시 한 번 더 시도한다. 네트워크 오류(throw)는 최대 2회까지
    // 짧은 대기 후 재시도하고, 그래도 실패하면(오프라인 등) 로그인 화면 대신
    // 재시도 유도 화면을 보여준다 — 네트워크 문제로 로그아웃 취급하지 않는다.
    const getAuthenticatedUser = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error } = await supabase.auth.getUser();
        if (!error) return data.user;
        // getUser()는 네트워크 실패도 throw가 아니라 error로 감싸 resolve한다
        // (isAuthRetryableFetchError로만 구분 가능) — 진짜 인증 실패(무효/만료된
        // refresh token 등)만 즉시 null로 판정하고, 네트워크성 오류는 재시도한다.
        if (!isAuthRetryableFetchError(error)) return null;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      return "network_error" as const;
    };

    getAuthenticatedUser().then(async (result) => {
      if (result === "network_error") {
        setNetworkError(true);
        setLoading(false);
        return;
      }

      if (!result) {
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

  if (networkError) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50 gap-3 px-6 text-center">
        <p className="text-sm text-gray-600">네트워크 연결을 확인할 수 없어요.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: "var(--color-k-navy)" }}
        >
          다시 시도
        </button>
      </div>
    );
  }

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



