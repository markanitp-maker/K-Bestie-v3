import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminEmail } from "@/lib/admin/isAdminEmail";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";

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

  const { pathname } = request.nextUrl;
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

  // 탈퇴 계정 로그인 게이트 추가
  if (!isAdminPath && pathname.startsWith("/parent") && pathname !== "/account/withdrawn") {
    // anon 클라이언트로 부모 상태 조회 (parents_select_own RLS 적용)
    const { data: parent } = await supabase
      .from("parents")
      .select("account_status")
      .eq("id", user.id)
      .maybeSingle();

    if (parent && (parent.account_status === "WITHDRAWN_PENDING" || parent.account_status === "RESTORE_REQUESTED")) {
      const url = request.nextUrl.clone();
      url.pathname = "/account/withdrawn";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/parent/:path*", "/admin/:path*", "/api/admin/:path*"],
};
