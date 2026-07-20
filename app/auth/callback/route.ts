import { NextResponse } from "next/server";
import { headers as nextHeaders } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";

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
        }
      } catch (err: any) {
        console.error("[auth/callback] parents table upsert exception:", err?.message || err);
      }

      return NextResponse.redirect(`${origin}${returnUrl}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
