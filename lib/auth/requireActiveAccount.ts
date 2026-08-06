import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function requireActiveAccount(userId: string): Promise<NextResponse | null> {
  const svc = createServiceClient();
  const { data: parent } = await svc
    .from("parents")
    .select("account_status")
    .eq("id", userId)
    .maybeSingle();

  if (!parent || (parent.account_status !== "ACTIVE" && parent.account_status !== "RESTORED")) {
    return NextResponse.json({ error: "탈퇴 처리된 계정입니다." }, { status: 403 });
  }

  return null;
}

/**
 * 온보딩 진행 중인 계정도 통과시키는 가드 (회원가입 플로우 전용).
 * AUTHENTICATED_INCOMPLETE / ONBOARDING / ACTIVE / RESTORED 모두 허용.
 * 탈퇴(WITHDRAWN) / 정지(SUSPENDED) 계정만 차단한다.
 */
export async function requireOnboardingOrActive(userId: string): Promise<NextResponse | null> {
  const svc = createServiceClient();
  const { data: parent } = await svc
    .from("parents")
    .select("account_status")
    .eq("id", userId)
    .maybeSingle();

  const ALLOWED_STATUSES = ["AUTHENTICATED_INCOMPLETE", "ONBOARDING", "ACTIVE", "RESTORED"];
  if (!parent || !ALLOWED_STATUSES.includes(parent.account_status)) {
    return NextResponse.json({ error: "접근할 수 없는 계정 상태입니다." }, { status: 403 });
  }

  return null;
}
