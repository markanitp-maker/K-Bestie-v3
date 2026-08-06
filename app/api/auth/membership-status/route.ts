import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveMembershipState } from "@/lib/auth/membershipState";

export const runtime = "nodejs";

// GET /api/auth/membership-status
// 서버 검증된 auth 사용자 기준으로 회원가입/멤버십 상태를 반환한다. 루트 페이지(app/page.tsx)의
// 자동 로그인 라우팅이 이 결과만을 근거로 목적지를 결정한다 — 클라이언트 localStorage나
// 검증되지 않은 getSession() 사용자 객체를 신뢰하지 않는다(요청서 §3.1).
export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await resolveMembershipState(user.id);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (err) {
    console.error("[membership-status] Fail-Closed error:", err);
    return NextResponse.json(
      { error: "MEMBERSHIP_RESOLUTION_FAILED" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  }
}

