"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { isStandaloneDisplay } from "@/lib/pwa/standalone";

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

        // 3. 구성원 계정(아이 아이디+비번 로그인)은 승인 시점에 이미 가족/프로필이 완결된
        // 상태로만 생성되므로(child_approval_requests 승인 처리 참고) 미완료 상태가 존재하지
        // 않는다 — 기존과 동일하게 역할별 대시보드로 바로 이동한다.
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

        // 4. 소셜 로그인(오너 후보) 계정.
        // 4-a. 먼저 기존 auto-join(초대 이메일/아이 프로필 이메일 매칭)을 그대로 시도한다 —
        // 2번째 보호자가 가족 초대를 수락하는 경우, 아이 이메일이 미리 등록돼 있던 경우를
        // 위한 기존 로직으로, 이 매칭에 성공하면 신규 회원가입 마법사를 거칠 필요가 없다.
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
          // reason이 "no_match"/"limit"이면 예약된 가족이 없다는 뜻이므로, 아래 4-b
          // 멤버십 상태 판정으로 넘어가 신규 회원가입 여부를 정식으로 판정한다.
        }

        // 4-b. 예약된 가족이 없는 경우 — 서버 검증된 멤버십 상태를 근거로 라우팅한다.
        // localStorage나 검증되지 않은 클라이언트 판단으로 절대 대체하지 않는다.
        const statusRes = await fetch("/api/auth/membership-status");
        if (!statusRes.ok) {
          throw new Error("membership-status check failed");
        }
        const status = await statusRes.json();

        switch (status.state) {
          case "ACTIVE_PARENT":
            await routePastPwaGate("/parent/home", router);
            return;
          case "ACTIVE_CHILD": {
            if (status.childId) localStorage.setItem("k_child_id", status.childId);
            await routePastPwaGate("/child/home", router);
            return;
          }
          case "SUSPENDED":
            router.replace("/account/suspended");
            return;
          case "DELETED":
            await supabase.auth.signOut();
            router.replace("/login");
            return;
          case "AUTHENTICATED_INCOMPLETE":
          default:
            router.replace(`/signup?step=${status.onboardingStep ?? "consent"}`);
            return;
        }
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

  return null;
}



