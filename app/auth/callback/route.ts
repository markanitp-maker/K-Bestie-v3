import { NextResponse } from "next/server";
import { headers as nextHeaders, cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";
import { createServiceClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

export async function GET(request: Request) {
  const { searchParams, origin: rawOrigin } = new URL(request.url);
  const headersList = await nextHeaders();

  // 포트포워딩·리버스프록시 환경에서 실제 외부 도메인 복원
  // 직접 접속 시에는 0.0.0.0만 localhost로 치환
  const forwardedHost = headersList.get("x-forwarded-host");
  const forwardedProto = headersList.get("x-forwarded-proto") ?? "https";
  let origin: string;
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0].trim();
    const proto = forwardedProto.split(",")[0].trim();
    origin = `${proto}://${host}`;
  } else {
    origin = rawOrigin.replace("//0.0.0.0", "//localhost");
  }

  console.log("[auth/callback] rawOrigin      :", rawOrigin);
  console.log("[auth/callback] x-forwarded-host :", forwardedHost);
  console.log("[auth/callback] x-forwarded-proto:", forwardedProto);
  console.log("[auth/callback] resolved origin  :", origin);

  const code = searchParams.get("code");
  const returnUrl = searchParams.get("returnUrl") || "/";

  if (code) {
    const cookieStore = await cookies();
    const targetRedirect = `${origin}${returnUrl}`;
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

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
