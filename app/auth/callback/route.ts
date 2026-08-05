import { NextResponse } from "next/server";
import { headers as nextHeaders } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
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
    const supabase = await createClient();

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      let redirectTo = returnUrl;
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (user && !userError) {
          const serviceSupabase = await createServiceClient();
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
            // REQUEST-AUTH-SIGNUP-AUTOLOGIN: 여기서 더 이상 목적지를 직접 결정하지 않는다.
            // 예전에는 가족이 없는 사용자를 곧바로 /onboarding(PWA 설치 안내)으로 보냈는데,
            // 이는 회원가입(약관 동의/보호자 정보/가족/아이 등록)이 전혀 끝나지 않은
            // 사용자에게도 PWA 설치 화면을 먼저 보여주는 버그의 원인이었다(요청서 §10).
            // 이제는 항상 returnUrl(기본 "/")로 보내고, 루트 페이지(app/page.tsx)가
            // /api/auth/membership-status의 서버 검증 결과만 근거로 로그인 완료 사용자는
            // 홈(및 PWA 게이트)으로, 미완료 사용자는 /signup으로 분기한다.
          } catch (e) {
            console.error("[auth/callback] behavior event logging failed:", e);
          }
        }
      } catch (err: any) {
        console.error("[auth/callback] parents table upsert exception:", err?.message || err);
      }

      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
