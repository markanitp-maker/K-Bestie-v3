import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminEmail } from "@/lib/admin/isAdminEmail";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";
import {
  QUIZ_PROXY_INTERNAL_PREFIX,
  QUIZ_PROXY_PATH_PREFIX,
  isQuizProxyPath,
} from "@/lib/play/quizProxyGate";

// matcher가 "/parent/:path*" 로 좁혀져 있어 이 미들웨어는 그 경로에서만 실행된다.
// 예전엔 거의 모든 경로(정적 파일 제외 전체)에서 매번 supabase.auth.getUser()로
// 네트워크 재검증을 했는데, 실제로 이 결과를 써서 리다이렉트하는 곳은 /parent/*
// 뿐이었다(자녀 페이지·API 라우트는 각자 자체적으로 auth.getUser()를 호출해 401
// 처리함). 즉 다른 경로에서의 검증은 전부 낭비였음 — matcher를 좁혀도 보호 범위는
// 동일하고, 불필요한 왕복만 사라진다.
// /admin, /api/admin 추가 후에도 이 원칙은 동일 — 무조건 !user 체크를 최우선으로
// 고정하고, 관리자 화이트리스트 분기는 그 뒤에 경로 가드로만 추가한다(/parent/*
// 트래픽에는 전혀 영향 없음).
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── /play/quiz → 독립 Quiz 배포 리버스 프록시 ──────────────────────────────
  // 이 분기는 반드시 middleware()의 **가장 첫 문장**이어야 한다. 아래
  // supabase.auth.getUser()보다 앞서지 않으면 (a) 리전 성능 문제(7513d8a) 이후
  // 의도적으로 matcher를 좁혀 없앤 불필요한 세션 재검증 왕복이 /play/quiz의 모든
  // 요청(정적 자산 포함)에서 되살아나고, (b) 이 요청이 K-Bestie 로그인 여부와
  // 무관하게 /login으로 잘못 튕겨나간다(인증은 프록시 핸들러가 직접 처리한다).
  //
  // 계획 Phase 7에서 인앱 레거시 구현(app/play/quiz/page.tsx)을 삭제하면서
  // `quiz_proxy` has-게이트도 함께 제거했다 — 되돌아갈 대상이 사라진 뒤에도 게이트를
  // 남겨두면 `quiz_proxy=off` 쿠키를 들고 있는 브라우저(캐너리 기간에 실제로 설정한
  // 테스터들)가 폴백 라우트 부재로 영구 404를 받는다. 즉 "죽은 코드"가 아니라 함정이
  // 되므로, 롤백 수단이 사라진 시점에 게이트도 같이 없애는 것이 정직하다.
  if (isQuizProxyPath(pathname)) {
    const proxyUrl = request.nextUrl.clone();
    proxyUrl.pathname = `${QUIZ_PROXY_INTERNAL_PREFIX}${pathname.slice(QUIZ_PROXY_PATH_PREFIX.length)}`;
    return NextResponse.rewrite(proxyUrl);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options ?? {})
          );
        },
      },
    }
  );

  // 세션 토큰 갱신 (IMPORTANT: getUser()가 내부적으로 refresh 처리)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isApiPath = pathname.startsWith("/api/");

  // 미인증 접근 — /api/*(신규 /api/admin/*)는 401 JSON, 그 외(/parent/*, /admin/*)는 /login 리다이렉트
  if (!user) {
    if (isApiPath) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // 관리자 화이트리스트 — /admin, /api/admin 경로에만 명시적으로 적용(그 외 /parent/*엔 영향 없음)
  const isAdminPath = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (isAdminPath && !isAdminEmail(user.email)) {
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // 탈퇴 계정 로그인 게이트
  // 053: 부모 계정 단위 베타 승인 게이트(approval_status)는 완전히 제거했다 — 누구나
  // 회원가입 직후 부모 메뉴에 즉시 접근한다. 아이별 승인은 child_approval_requests로
  // 이전되어 실제 계정/프로필이 생기기 전에는 아이가 서비스에 나타나지 않는 방식으로
  // 자연스럽게 게이트된다(별도 미들웨어 체크 불필요).
  if (
    !isAdminPath &&
    (pathname.startsWith("/parent") || pathname.startsWith("/signup")) &&
    pathname !== "/account/withdrawn" &&
    pathname !== "/account/suspended"
  ) {
    const { data: parent } = await supabase
      .from("parents")
      .select("account_status, withdrawn_at, purge_scheduled_at")
      .eq("id", user.id)
      .maybeSingle();

    if (parent) {
      const isWithdrawnStatus =
        parent.account_status === "WITHDRAWN_PENDING" ||
        parent.account_status === "RESTORE_REQUESTED" ||
        parent.account_status === "WITHDRAWN";

      if (isWithdrawnStatus || parent.withdrawn_at) {
        const now = new Date();
        const purgeDate = parent.purge_scheduled_at
          ? new Date(parent.purge_scheduled_at)
          : parent.withdrawn_at
          ? new Date(new Date(parent.withdrawn_at).getTime() + 30 * 24 * 60 * 60 * 1000)
          : null;

        if (purgeDate && now < purgeDate) {
          const url = request.nextUrl.clone();
          url.pathname = "/account/withdrawn";
          return NextResponse.redirect(url);
        }
      }

      // REQUEST-AUTH-SIGNUP-AUTOLOGIN: 관리자 이용정지(SUSPENDED) 계정도 탈퇴와 동일한
      // 방식으로 접근을 차단한다.
      if (parent.account_status === "SUSPENDED") {
        const url = request.nextUrl.clone();
        url.pathname = "/account/suspended";
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}

/**
 * Node 런타임 고정(보안 리뷰 반영). Edge 런타임에서는 `process.env`가 빌드 시점에
 * 인라인되는데, 프록시 Route Handler는 `runtime = "nodejs"`라 요청 시점에 읽는다.
 * 두 쪽이 어긋나면 대시보드에서 `QUIZ_PROXY_DEFAULT`만 바꾸고 재배포하지 않았을 때
 * middleware는 계속 rewrite하는데 핸들러는 404를 내는 상태가 된다. 양쪽 모두
 * 요청 시점 읽기로 통일한다.
 */
export const runtime = "nodejs";

export const config = {
  // "/play/quiz"(+하위)는 인증 검사용이 아니라 위 has-게이트 분기 전용으로 추가된
  // 것이다 — 그 분기는 getUser()를 호출하기 전에 항상 return한다.
  matcher: [
    "/parent/:path*",
    "/signup",
    "/admin/:path*",
    "/api/admin/:path*",
    "/play/quiz",
    "/play/quiz/:path*",
  ],
};
