"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { isStandaloneDisplay } from "@/lib/pwa/standalone";
import BetaLandingPage from "@/components/landing/BetaLandingPage";

const PWA_INTRO_SEEN_KEY = "k_pwa_intro_seen";

// 회원가입/필수 등록 완료(ACTIVE_PARENT/ACTIVE_CHILD) 사용자가 처음 홈에 도착할 때만
// PWA 설치 안내(/onboarding)를 한 번 보여준다 — 요청서 §10 "PWA 설치 안내는 회원가입
// 완료 및 로그인 이후에만 표시한다"에 대응. 이미 설치됐거나(standalone) 이미 본 적
// 있으면 목적지로 바로 이동한다.
async function routePastPwaGate(
  destination: "/parent/home" | "/child/home",
  router: ReturnType<typeof useRouter>
) {
  if (typeof window === "undefined") {
    router.replace(destination);
    return;
  }
  const alreadySeen = window.localStorage.getItem(PWA_INTRO_SEEN_KEY) === "1";
  if (alreadySeen || isStandaloneDisplay(window)) {
    router.replace(destination);
    return;
  }
  router.replace(`/onboarding?next=${encodeURIComponent(destination)}`);
}

export default function HubPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState(false);
  const [showGuestLanding, setShowGuestLanding] = useState(false);

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
        // 057: 세션이 없는 방문자(GUEST)는 /login으로 즉시 리다이렉트하는 대신
        // 이 자리에서 베타 테스터 모집 랜딩페이지를 보여준다. 기존 회원은
        // 랜딩페이지 헤더의 "기존 회원 로그인" 버튼으로 /login에 간다.
        setShowGuestLanding(true);
        setLoading(false);
        return;
      }

      try {
        // 1. 단일 공통 서버 판정 (membership-status) 최우선 실행!
        // 라우팅 우선순위: 복구 가능 탈퇴 계정 -> 정지·영구 삭제 -> 활성 기존 계정 -> 가입 미완료 -> 신규 계정
        const statusRes = await fetch("/api/auth/membership-status", { cache: "no-store" });
        if (!statusRes.ok) {
          throw new Error("membership-status check failed");
        }
        const status = await statusRes.json();

        // 1순위 & 2순위: 탈퇴 / 정지 / 삭제 가드
        if (status.state === "RESTOREABLE_WITHDRAWN") {
          router.replace("/account/withdrawn");
          return;
        }
        if (status.state === "SUSPENDED") {
          router.replace("/account/suspended");
          return;
        }
        if (status.state === "DELETED") {
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        // 2. 비밀번호 설정 및 계정 역할 조회
        const pwCheckRes = await fetch("/api/auth/change-password", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (!pwCheckRes.ok) {
          throw new Error("Password change check failed");
        }

        const pwData = await pwCheckRes.json();

        // 만약 비밀번호를 반드시 변경해야 하는 경우 (구성원 첫 로그인)
        if (pwData.must_change_password) {
          router.replace("/auth/setup-password");
          return;
        }

        // 구성원 계정(아이 아이디+비번 로그인)
        if (pwData.is_member_account) {
          if (pwData.role === "child") {
            const childMeRes = await fetch("/api/child/me");
            if (childMeRes.ok) {
              const childInfo = await childMeRes.json();
              if (childInfo?.id) {
                localStorage.setItem("k_child_id", childInfo.id);
              }
            }
            await routePastPwaGate("/child/home", router);
          } else {
            await routePastPwaGate("/parent/home", router);
          }
          return;
        }

        // 3순위: 활성 기존 계정
        if (status.state === "ACTIVE_PARENT") {
          await routePastPwaGate("/parent/home", router);
          return;
        }
        if (status.state === "ACTIVE_CHILD") {
          if (status.childId) localStorage.setItem("k_child_id", status.childId);
          await routePastPwaGate("/child/home", router);
          return;
        }

        // 4. 소셜 로그인 초대/매칭(auto-join) 시도
        const joinRes = await fetch("/api/auth/auto-join", { method: "POST" });
        if (joinRes.ok) {
          const joinData = await joinRes.json();
          if (joinData.joined) {
            if (joinData.role === "child") {
              if (joinData.child_profile_id) {
                localStorage.setItem("k_child_id", joinData.child_profile_id);
              }
              await routePastPwaGate("/child/home", router);
            } else {
              await routePastPwaGate("/parent/home", router);
            }
            return;
          }
          if (joinData.reason === "no_email") {
            alert(joinData.message || "이메일 정보가 없어 로그인이 어렵습니다.");
            await supabase.auth.signOut();
            router.replace("/login");
            return;
          }
        }

        // 4순위: 가입 미완료 계정 (onboarding step)
        router.replace(`/signup?step=${status.onboardingStep ?? "consent"}`);
        return;
      } catch (err) {
        console.error("Hub page initialization error:", err);
        // 상태 판정 자체가 실패한 경우 회원가입 미완료로 오판해 기존 활성 회원을 회원가입
        // 화면으로 튕겨내는 것보다는, 안전하게 재시도 유도 화면을 보여주는 편이 낫다
        // (요청서 §13.3 기존 보호자 자동 로그인 보존 요구사항).
        setNetworkError(true);
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

  if (showGuestLanding) {
    return <BetaLandingPage />;
  }

  return null;
}



