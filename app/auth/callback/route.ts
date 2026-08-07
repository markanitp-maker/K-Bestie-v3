import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";
import { createServiceClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import { safePostAuthReturnUrl } from "@/lib/auth/safeReturnUrl";

export async function GET(request: Request) {
  const { searchParams, origin: rawOrigin } = new URL(request.url);
  // Next가 검증해 구성한 요청 URL origin만 사용한다. 클라이언트가 전달할 수 있는
  // x-forwarded-host/proto로 redirect origin을 재구성하면 외부 도메인 주입 여지가 있다.
  const origin = rawOrigin.replace("//0.0.0.0", "//localhost");

  const code = searchParams.get("code");
  const returnUrl = safePostAuthReturnUrl(searchParams.get("returnUrl"));
  const returnQuery = returnUrl === "/" ? "" : `&returnUrl=${encodeURIComponent(returnUrl)}`;

  if (searchParams.get("error") === "access_denied") {
    return NextResponse.redirect(`${origin}/login?error=cancelled${returnQuery}`);
  }

  if (code) {
    const cookieStore = await cookies();
    // callback에서 원래 목적지로 직접 보내면 신규·미완료 사용자도 회원상태 판정을
    // 우회할 수 있다. 항상 허브(/)를 먼저 거쳐 서버 검증 결과가 ACTIVE일 때만 복원한다.
    const targetRedirect = returnUrl === "/"
      ? `${origin}/`
      : `${origin}/?returnUrl=${encodeURIComponent(returnUrl)}`;
    const response = NextResponse.redirect(targetRedirect);

    const supabase = createServerClient(
      getSupabaseUrl(),
      getSupabaseAnonKey(),
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Server Component 무시
            }
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options ?? {})
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (user && !userError) {
          const serviceSupabase = createServiceClient();
          await logBehaviorEvent({
            eventName: "social_auth_completed",
            actorType: "parent",
            actorId: user.id,
            feature: "auth",
            route: "/auth/callback",
          });
          const { error: upsertError } = await serviceSupabase
            .from("parents")
            .upsert(
              {
                id: user.id,
                email: user.email ?? "",
                name: (user.user_metadata as any)?.name ?? ""
              },
              { onConflict: "id", ignoreDuplicates: true }
            );

          if (upsertError) {
            console.error("[auth/callback] parents table upsert error:", upsertError.message);
          }

          try {
            const { data: member } = await serviceSupabase
              .from("family_members")
              .select("family_id")
              .eq("user_id", user.id)
              .maybeSingle();

            if (member?.family_id) {
              await logBehaviorEvent({
                eventName: "parent_login",
                actorType: "parent",
                actorId: user.id,
                familyId: member.family_id,
                feature: "auth",
                route: "/auth/callback"
              });
            }
          } catch (e) {
            console.error("[auth/callback] behavior event logging failed:", e);
          }
        }
      } catch (err: any) {
        console.error("[auth/callback] parents table upsert exception:", err?.message || err);
      }

      return response;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth${returnQuery}`);
}
